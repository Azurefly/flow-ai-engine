import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  businessStateJoinSql,
  businessStateLabelSql,
  presentProcessInstance,
} from "./process-instance-state";
const mocks = vi.hoisted(() => ({ query: vi.fn(), permission: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: mocks.permission,
  recordAuthorizationAudit: vi.fn(),
}));
import { listProcessInstances, pageProcessInstances } from "./p1-service";
import { getWorkflowRun } from "./workflow-engine";

describe("instance state scopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permission.mockResolvedValue(false);
  });
  const row = {
    id: "run-1",
    workflowId: "workflow-1",
    flowType: "state",
    status: "waiting",
    currentStateCode: "REVIEW",
    stateName: "待审核",
    participantStatusName: null,
    availableOperationsJson: "[]",
    cursorCreatedAt: "2026-10-04 12:00:00.000000",
  };
  it("separates business state from execution and preserves personal operations", () => {
    expect(
      presentProcessInstance({
        ...row,
        participantStatusName: "处理中",
        availableOperationsJson: '[{"taskId":"task-1"}]',
      })
    ).toMatchObject({
      stateCode: "REVIEW",
      stateName: "待审核",
      displayStatus: "waiting",
      participantStatusName: "处理中",
      availableOperations: [{ taskId: "task-1" }],
    });
    expect(
      presentProcessInstance({
        ...row,
        flowType: "control",
        status: "success",
        participantStatusName: "已审核",
      })
    ).toMatchObject({
      stateName: null,
      stateCode: null,
      participantStatusName: "已审核",
      displayStatus: "success",
    });
  });
  it("never grants access because the instance has a business state", async () => {
    mocks.query.mockResolvedValue([[row]]);
    expect(
      await listProcessInstances({ id: 7, role: "user" }, { view: "all" })
    ).toEqual([]);
    expect(
      (
        await pageProcessInstances(
          { id: 7, role: "user" },
          { view: "all", limit: 10 }
        )
      ).items
    ).toEqual([]);
    expect(mocks.permission).toHaveBeenCalledWith(
      { id: 7, role: "user" },
      "workflow-1",
      "workflow:view"
    );
  });
  it("retains the existing viewer's participant access and operations", async () => {
    mocks.query.mockResolvedValue([
      [{ ...row, participantStatusName: "处理中" }],
    ]);
    const user = { id: 7, role: "user" } as const;
    expect((await pageProcessInstances(user, { view: "all", limit: 10 })).items)
      .toMatchObject([{ participantStatusName: "处理中", canViewRun: false, availableOperations: [] }]);
    expect(mocks.permission).toHaveBeenCalledTimes(1);
    mocks.permission.mockResolvedValue(true);
    expect(await listProcessInstances(user, { view: "all" }))
      .toMatchObject([{ participantStatusName: "处理中", canViewRun: true }]);
  });
  it("queries instance numbers with bound parameters and returns only summary columns", async () => {
    mocks.query.mockResolvedValue([[row]]);
    const user = { id: 7, role: "admin" } as const;
    const id = "ac12fe90-1234-4789-8123-0123456789ab";
    const page = await pageProcessInstances(user, { view: "all", search: id.toUpperCase() });
    const [sql, parameters] = mocks.query.mock.calls[0];
    expect(sql).toContain("WHERE r.id=?");
    expect(sql).not.toMatch(/r\.\*|definitionSnapshotJson|inputJson|contextJson|executionLockToken/);
    expect(parameters).toContain(id);
    expect(page.items[0]).not.toHaveProperty("cursorCreatedAt");
    expect(page.items[0]).toHaveProperty("canViewRun", true);

    await pageProcessInstances(user, { view: "all", search: "RUN ac12fe90" });
    expect(mocks.query.mock.calls[1][0]).toContain("WHERE r.id LIKE ?");
    expect(mocks.query.mock.calls[1][1]).toContain("ac12fe90%");
    await pageProcessInstances(user, { view: "initiated", search: "ac12fe90", status: "waiting" });
    expect(mocks.query.mock.calls[2][0]).toContain("OR r.id LIKE ?");
    expect(mocks.query.mock.calls[2][0]).toContain("initiator.username");
    expect(mocks.query.mock.calls[2][1]).toEqual([7, 7, "waiting", "waiting", "ac12fe90", "ac12fe90%", 200]);
  });
  it("takes business labels from the latest matching immutable transition, only for state runs", () => {
    expect(businessStateJoinSql).toContain("r.flowType='state'");
    expect(businessStateJoinSql).toContain("MAX(latest.sequenceNo)");
    expect(businessStateJoinSql).toContain(
      "BINARY bs.toStateCode=BINARY r.currentStateCode"
    );
    expect(businessStateLabelSql).toContain("JSON_TYPE");
    expect(businessStateLabelSql).not.toContain("ps.stateName");
  });
  it("details keep the viewer's handling label separate and bind only that viewer", async () => {
    mocks.query
      .mockResolvedValueOnce([[{ ...row, participantStatusName: "我的待办" }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [{ toStateCode: "REVIEW", payloadJson: { stateName: "待审核" } }],
      ])
      .mockResolvedValueOnce([[]]);
    expect(await getWorkflowRun("run-1", 7)).toMatchObject({
      currentStateName: "待审核",
      participantStatusName: "我的待办",
    });
    expect(mocks.query.mock.calls[0][0]).toContain("latest.userId=?");
    expect(mocks.query.mock.calls[0][1]).toEqual([7, "run-1"]);
  });
  it("control detail never labels a legacy business code as current business state", async () => {
    mocks.query
      .mockResolvedValueOnce([[{ ...row, flowType: "control" }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [{ toStateCode: "REVIEW", payloadJson: { stateName: "待审核" } }],
      ])
      .mockResolvedValueOnce([[]]);
    expect(await getWorkflowRun("run-1")).toMatchObject({
      currentStateName: null,
    });
    expect(mocks.query.mock.calls[0][0]).toContain(
      "NULL AS participantStatusName"
    );
    expect(mocks.query.mock.calls[0][1]).toEqual(["run-1"]);
  });
});
