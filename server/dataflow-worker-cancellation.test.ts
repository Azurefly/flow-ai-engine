import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => ({
      query: mocks.query,
      beginTransaction: vi.fn(),
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: mocks.release,
    }),
  }),
}));
import { compileDataflowExecutionPlan, runDataflowJobOnce } from "./p2-service";

let status: string,
  leaseToken: string,
  valid: number,
  checks: number,
  hook: (count: number) => void;
let nodeStatus: Map<string, string>,
  plan: ReturnType<typeof compileDataflowExecutionPlan>;
const definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      position: { x: 200, y: 0 },
      config: {},
    },
  ],
  edges: [{ id: "edge", sourceNodeId: "start", targetNodeId: "end" }],
};
beforeEach(() => {
  vi.resetAllMocks();
  status = "leased";
  leaseToken = "";
  valid = 1;
  checks = 0;
  hook = () => {};
  nodeStatus = new Map();
  plan = compileDataflowExecutionPlan(definition);
  mocks.query.mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.startsWith("SELECT j.id,j.runId"))
      return [[{ id: "job", runId: "run", attempt: 0, maxAttempts: 3 }]];
    if (sql.startsWith("SELECT projectId,status"))
      return [
        [
          {
            status: "queued",
            projectId: "project",
            executionPlanJson: plan.plan,
            executionPlanHash: plan.planHash,
            requestId: null,
          },
        ],
      ];
    if (sql.includes("status='leased',attempt=attempt+1")) {
      leaseToken = params[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT status,leaseToken")) {
      checks++;
      hook(checks);
      return [[{ status, leaseToken, leaseValid: valid }]];
    }
    if (sql.includes("FROM dataflow_node_run nr")) return [[]];
    if (sql.startsWith("INSERT INTO dataflow_node_run"))
      nodeStatus.set(params[2], "running");
    if (sql.startsWith("SELECT id,attempt FROM dataflow_node_run"))
      return [[{ id: `node-${params[1]}`, attempt: 1 }]];
    if (sql.includes("SET status='success',outputJson"))
      nodeStatus.set(
        String(params[params.length - 2]).replace("node-", ""),
        "success"
      );
    if (sql.startsWith("SELECT")) return [[]];
    return [{ affectedRows: 1 }];
  });
});
const calls = (prefix: string) =>
  mocks.query.mock.calls.filter(([sql]) => String(sql).startsWith(prefix));
function cancelAt(count: number) {
  hook = current => {
    if (current === count) {
      status = "cancelled";
      for (const [id, state] of nodeStatus)
        if (state === "running") nodeStatus.set(id, "cancelled");
    }
  };
}
it.each([1, 2, 5])(
  "第%i个围栏取消后正常停止，不再提交新产物或重试覆盖",
  async count => {
    cancelAt(count);
    await expect(runDataflowJobOnce("run")).resolves.toBe(true);
    expect(calls("INSERT INTO dataflow_dataset_artifact")).toHaveLength(
      count === 5 ? 2 : 0
    );
    expect(
      calls("UPDATE dataflow_run_job SET status='completed'")
    ).toHaveLength(0);
    expect(
      mocks.query.mock.calls.filter(([sql]) =>
        String(sql).includes("SET status=?,lastErrorJson")
      )
    ).toHaveLength(0);
    expect([...nodeStatus.values()]).not.toContain("running");
    expect(mocks.rollback).toHaveBeenCalled();
  }
);
it("未取消仍完成所有节点、产物和运行，Job先于运行加锁", async () => {
  await expect(runDataflowJobOnce("run")).resolves.toBe(true);
  expect(calls("INSERT INTO dataflow_dataset_artifact")).toHaveLength(2);
  expect(calls("UPDATE dataflow_run_job SET status='completed'")).toHaveLength(
    1
  );
  expect(calls("UPDATE dataflow_run SET status='success'")).toHaveLength(1);
  const sql = mocks.query.mock.calls.map(([s]) => String(s));
  expect(sql[0]).not.toContain("JOIN dataflow_run");
  expect(sql[0]).toContain("FOR UPDATE SKIP LOCKED");
  expect(sql[1]).toContain("FROM dataflow_run WHERE id=? LIMIT 1 FOR UPDATE");
});
it.each(["expired", "replaced"])(
  "%s租约仍是独立错误，旧Worker不覆盖状态",
  async kind => {
    hook = count => {
      if (count === 2) {
        if (kind === "expired") valid = 0;
        else leaseToken = "replacement";
      }
    };
    await expect(runDataflowJobOnce("run")).rejects.toThrow("租约已失效");
    expect(calls("INSERT INTO dataflow_dataset_artifact")).toHaveLength(0);
    expect(calls("UPDATE dataflow_run SET status='success'")).toHaveLength(0);
  }
);
it("失败已发生但等待失败回写锁时取消，不再重试或改成失败", async () => {
  hook = count => {
    if (count === 2) throw new Error("original failure");
    if (count === 3) status = "cancelled";
  };
  await expect(runDataflowJobOnce("run")).resolves.toBe(true);
  expect(calls("UPDATE dataflow_node_run SET status='failed'")).toHaveLength(0);
  expect(
    mocks.query.mock.calls.filter(([sql]) =>
      String(sql).includes("SET status=?,lastErrorJson")
    )
  ).toHaveLength(0);
});
