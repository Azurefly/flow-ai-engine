import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  dataflow: vi.fn(),
  sourceTest: vi.fn(),
  schedules: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => ({
      query: mocks.query,
      beginTransaction: vi.fn(),
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: vi.fn(),
    }),
  }),
}));
vi.mock("./workflow-engine", () => ({
  executePreparedWorkflowRun: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  reconcileDueWorkflowWaits: async () => 0,
  reconcileDueWorkflowTaskSchedules: async () => 0,
  reconcileWorkflowContinuations: async () => 0,
  submitWorkflowRun: vi.fn(),
  WorkflowExecutionInjectedCrash: class extends Error {},
}));
vi.mock("./p2-service", () => ({
  queueDueNativeDataflowsOnce: mocks.schedules,
  runDataflowJobOnce: mocks.dataflow,
  runDataSourceTestJobOnce: mocks.sourceTest,
}));

let worker: typeof import("./workflow-worker");
let releases: Array<() => void>;
let inFlight: Array<Promise<unknown>>;
function hold() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(done => {
    resolve = done;
  });
  releases.push(() => resolve(false));
  return { promise, resolve };
}
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  releases = [];
  inFlight = [];
  mocks.query.mockImplementation(async (sql: string) =>
    sql.trimStart().startsWith("SELECT") ? [[]] : [{ affectedRows: 0 }]
  );
  mocks.dataflow.mockResolvedValue(false);
  mocks.sourceTest.mockResolvedValue(false);
  mocks.schedules.mockResolvedValue(0);
  worker = await import("./workflow-worker");
});
afterEach(async () => {
  releases.forEach(release => release());
  await Promise.allSettled(inFlight);
  await worker.stopWorkflowWorker(1000);
  vi.unstubAllEnvs();
});

it("数据作业等待时，状态/控制轮询和源测试仍可独立推进", async () => {
  const blocked = hold();
  mocks.dataflow.mockReturnValue(blocked.promise);
  const data = worker.runDataflowWorkerOnce();
  inFlight.push(data);
  expect(worker.getWorkflowWorkerStatus().channels.dataflow).toBe(true);
  expect(await worker.runWorkflowWorkerOnce()).toBe(false);
  expect(mocks.schedules).toHaveBeenCalledOnce();
  expect(await worker.runSourceTestWorkerOnce()).toBe(false);
  expect(mocks.sourceTest).toHaveBeenCalledOnce();
  expect(worker.getWorkflowWorkerStatus().processing).toBe(true);
  blocked.resolve(true);
  expect(await data).toBe(true);
  expect(worker.getWorkflowWorkerStatus().processing).toBe(false);
});

it.each(["dataflow", "sourceTest"] as const)(
  "%s忙时不重复领取，完成后允许下一次领取",
  async channel => {
    const blocked = hold();
    mocks[channel].mockReturnValueOnce(blocked.promise);
    const poll =
      channel === "dataflow"
        ? worker.runDataflowWorkerOnce
        : worker.runSourceTestWorkerOnce;
    const first = poll();
    inFlight.push(first);
    expect(await poll()).toBe(false);
    expect(mocks[channel]).toHaveBeenCalledOnce();
    blocked.resolve(true);
    expect(await first).toBe(true);
    expect(await poll()).toBe(false);
    expect(mocks[channel]).toHaveBeenCalledTimes(2);
  }
);

it("通道失败释放占用，不阻塞其他通道或下一次执行", async () => {
  mocks.dataflow.mockRejectedValueOnce(new Error("connector failed"));
  await expect(worker.runDataflowWorkerOnce()).rejects.toThrow(
    "connector failed"
  );
  expect(worker.getWorkflowWorkerStatus().channels.dataflow).toBe(false);
  expect(await worker.runSourceTestWorkerOnce()).toBe(false);
  expect(await worker.runDataflowWorkerOnce()).toBe(false);
});

it("停机覆盖数据通道，超时不伪报完成，停止后不再唤醒任务", async () => {
  const blocked = hold();
  mocks.dataflow.mockReturnValueOnce(blocked.promise);
  const data = worker.runDataflowWorkerOnce();
  inFlight.push(data);
  await expect(worker.stopWorkflowWorker(0)).rejects.toThrow("仍在执行");
  expect(worker.getWorkflowWorkerStatus().processing).toBe(true);
  worker.wakeWorkflowWorker();
  await Promise.resolve();
  expect(mocks.schedules).not.toHaveBeenCalled();
  blocked.resolve(false);
  await data;
  await expect(worker.stopWorkflowWorker(1000)).resolves.toBeUndefined();
});

it("已排队的唤醒在停机后也不再启动任何通道", async () => {
  vi.stubEnv("WORKFLOW_WORKER_ENABLED", "true");
  worker.wakeWorkflowWorker();
  await worker.stopWorkflowWorker(0);
  await Promise.resolve();
  expect(mocks.dataflow).not.toHaveBeenCalled();
  expect(mocks.sourceTest).not.toHaveBeenCalled();
  expect(mocks.schedules).not.toHaveBeenCalled();
});

it("唤醒并行启动有界通道，重复唤醒不重复领取忙任务", async () => {
  vi.stubEnv("WORKFLOW_WORKER_ENABLED", "true");
  const data = hold(),
    source = hold();
  mocks.dataflow.mockReturnValue(data.promise);
  mocks.sourceTest.mockReturnValue(source.promise);
  worker.wakeWorkflowWorker();
  await Promise.resolve();
  expect(mocks.dataflow).toHaveBeenCalledOnce();
  expect(mocks.sourceTest).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(mocks.schedules).toHaveBeenCalledOnce());
  worker.wakeWorkflowWorker();
  await Promise.resolve();
  expect(mocks.dataflow).toHaveBeenCalledOnce();
  expect(mocks.sourceTest).toHaveBeenCalledOnce();
});

it("正常停机等待源测试结束，而不是只等待状态/控制通道", async () => {
  const source = hold();
  mocks.sourceTest.mockReturnValueOnce(source.promise);
  const running = worker.runSourceTestWorkerOnce();
  inFlight.push(running);
  let stopped = false;
  const stopping = worker.stopWorkflowWorker(1000).then(() => {
    stopped = true;
  });
  inFlight.push(stopping);
  await Promise.resolve();
  expect(stopped).toBe(false);
  source.resolve(false);
  await stopping;
  expect(stopped).toBe(true);
  expect(worker.getWorkflowWorkerStatus().processing).toBe(false);
});
