import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import superjson from "superjson";
import { createLeaveApprovalDefinition } from "../shared/leave-approval-workflow";
import { createParticipantStateExample } from "../shared/participant-state-example";
import target from "./acceptance-target.cjs";

class Session {
  private cookie = "";

  constructor(private readonly origin: string) {}

  async call(procedure: string, input: unknown = null, write = false) {
    const json = JSON.stringify(superjson.serialize(input));
    const suffix = write ? "" : "?input=" + encodeURIComponent(json);
    const response = await fetch(this.origin + "/api/trpc/" + procedure + suffix, {
      method: write ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", cookie: this.cookie },
      ...(write ? { body: json } : {}),
    });
    const result = await response.json();
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(";", 1)[0];
    if (!response.ok || result.error) {
      const code = result.error?.json?.data?.code;
      throw Object.assign(new Error(`${procedure} HTTP ${response.status} ${code ?? ""}`),
        { status: response.status, code });
    }
    return superjson.deserialize<any>(result.result.data);
  }
}

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 28_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await wait(300);
  }
  throw new Error(`等待业务终态超时 ${label}`);
}

const node = (id: string, type: string, name: string, x: number, y: number, config = {}) =>
  ({ id, type, name, config, position: { x, y } });
const edge = (from: string, to: string, sourceHandle = "default") =>
  ({ id: `${from}-${to}-${sourceHandle}`, sourceNodeId: from, targetNodeId: to, sourceHandle });
const definition = (nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]) =>
  ({ schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes, edges });

function controlDefinition(firstReviewer: number, secondReviewer: number) {
  const review = (id: string, name: string, reviewer: number, y: number) =>
    node(id, "operate", name, 460, y, {
      assigneeMode: "user", assigneeUserId: reviewer, signMode: "single",
      nodeDh: id.toUpperCase(), czmc: name, instruction: "核对本分支的合成记录",
    });
  return definition([
    node("start", "start", "接收工单", 0, 170),
    node("dispatch", "router", "并行派发复核", 230, 170, {
      nodeDh: "DISPATCH", lymc: "并行派发复核", broadcast: true,
      parallelJoinNodeId: "merge", defaultRoute: "service",
      routes: [
        { handle: "service", label: "服务复核", targetNodeId: "service", priority: 100, conditions: [] },
        { handle: "finance", label: "费用复核", targetNodeId: "finance", priority: 90, conditions: [] },
      ],
    }),
    review("service", "服务记录复核", firstReviewer, 40),
    review("finance", "费用凭据复核", secondReviewer, 300),
    node("merge", "transform", "汇聚复核结果", 700, 170, { parallelForNodeId: "dispatch" }),
    node("end", "end", "复核完成", 930, 170),
  ], [
    edge("start", "dispatch"), edge("dispatch", "service", "service"), edge("dispatch", "finance", "finance"),
    edge("service", "merge", "approved"), edge("finance", "merge", "approved"), edge("merge", "end"),
  ]);
}

function dataDefinition(assetId: string) {
  return definition([
    node("start", "start", "开始", 0, 130),
    node("source", "source", "读取订单样本", 235, 130, { assetId, limit: 50 }),
    node("filter", "filter", "保留已付款订单", 470, 130, { filterField: "status", operator: "equals", filterValue: "已付款" }),
    node("quality", "quality_gate", "校验完整订单", 705, 130, { minRows: 1, maxNullRate: 0 }),
    node("aggregate", "aggregate", "按地区汇总金额", 940, 130, { groupBy: ["region"], metrics: [
      { name: "orderCount", operation: "count" }, { name: "total", operation: "sum", field: "amount" },
    ] }),
    node("end", "end", "输出地区汇总", 1175, 130),
  ], [
    edge("start", "source"), edge("source", "filter"), edge("filter", "quality"),
    edge("quality", "aggregate"), edge("aggregate", "end"),
  ]);
}

function messageDefinition() {
  return definition([
    node("start", "start", "开始", 0, 130),
    node("message", "message_catch", "等待订单消息", 250, 130,
      { messageName: "order.paid", correlationKey: "{{input.businessKey}}" }),
    node("end", "end", "消息已接收", 500, 130, { resultTemplate: "{{vars.message.payload}}" }),
  ], [edge("start", "message"), edge("message", "end")]);
}

function multipleResultsDefinition(assetId: string) {
  return definition([
    node("start", "start", "开始", 0, 130),
    node("source", "source", "读取订单样本", 235, 130, { assetId, limit: 50 }),
    node("regions", "map", "地区投影", 470, 30, { columns: ["region"] }),
    node("amounts", "map", "金额投影", 470, 235, { columns: ["amount"] }),
    node("end", "end", "地区结果", 705, 30),
    node("output", "output", "金额结果", 705, 235, { outputName: "  金额明细  " }),
  ], [edge("start", "source"), edge("source", "regions"), edge("source", "amounts"),
    edge("regions", "end"), edge("amounts", "output")]);
}

export type DemoRun = { workflowId: string; runId: string; name: string };
export type ReleaseExamples = { projectId: string; state: DemoRun; control: DemoRun; data: DemoRun; results: DemoRun; messageWorkflowId: string };

export async function runProductAcceptance(capture?: (examples: ReleaseExamples) => Promise<void>) {
  const { base, username, password } = target.acceptanceLogin(process.env);
  const admin = new Session(base);
  const record = { base, flows: {}, organization: {}, access: {}, timeFilters: {}, cleanup: {} };
  const tag = randomUUID().slice(0, 8);
  const projectCode = "REL_" + tag.toUpperCase();
  const members: Array<{ id: number; client: Session }> = [];
  const departments: Array<{ id: string; userIds: number[] }> = [];
  const workflowRuns: string[] = [];
  const dataRuns: string[] = [];
  let projectId: string | undefined;
  let cleanupError: unknown;

  async function member(key: string, name: string) {
    const login = { username: `rel_${key}_${tag}`, password: randomUUID() + randomUUID() };
    const { userId } = await admin.call("iam.createUser", { ...login, name, role: "user" }, true);
    const client = new Session(base);
    members.push({ id: userId, client });
    await client.call("auth.login", login, true);
    assert.equal((await client.call("auth.me")).id, userId);
    return { id: userId, client, login };
  }

  async function publish(flowType: string, name: string, graph: unknown, input: unknown = {}) {
    const draft = await admin.call("project.createWorkflow", { projectId, name, flowType, definition: graph }, true);
    const observed = await admin.call("workflow.get", { id: draft.id });
    await admin.call("project.auditWorkflow", { projectId, workflowId: draft.id, auditStatus: "approved",
      expectedDefinitionVersion: observed.definitionVersion, expectedAuditStatus: observed.auditStatus }, true);
    const approved = await admin.call("workflow.get", { id: draft.id });
    await admin.call("workflow.publish", { id: draft.id, expectedDefinitionVersion: approved.definitionVersion }, true);
    const ready = await admin.call("workflow.runReadiness", { workflowId: draft.id, mode: "formal", input }, true);
    assert(ready.canStart, `正式运行预检失败 ${flowType}`);
    return { id: draft.id, name };
  }

  const detail = (runId: string) => admin.call("workflow.runDetail", { runId });
  const dataDetail = (runId: string) => admin.call("data.runDetail", { projectId, runId });
  const terminal = (status: string) => ["success", "failed", "cancelled", "terminated"].includes(status);
  async function oneTask(client: Session, runId: string, nodeId: string) {
    return until(
      () => client.call("task.list", { view: "todo", projectId, runId }),
      tasks => tasks.some((item: any) => item.nodeId === nodeId),
      nodeId,
    ).then(tasks => tasks.find((item: any) => item.nodeId === nodeId));
  }
  const approve = (client: Session, taskId: string) => client.call("task.execute", {
    taskId, result: { decision: "approved", outcome: "approved", comment: "合成样本复核通过" },
  }, true);

  await admin.call("auth.login", { username, password }, true);
  try {
    const employee = await member("employee", "示例员工");
    const supervisor = await member("lead", "示例直属上级");
    const manager = await member("manager", "示例部门经理");
    const observer = await member("viewer", "示例观察员");
    const org = await admin.call("config.createOrganizationUnit", { code: `RMGT_${tag}`, name: "示例管理部", managerUserId: manager.id }, true);
    departments.push({ id: org.id, userIds: [] });
    const team = await admin.call("config.createOrganizationUnit", { code: `RTEAM_${tag}`, name: "示例研发组", parentUnitId: org.id, managerUserId: supervisor.id }, true);
    departments.push({ id: team.id, userIds: [] });
    for (const [index, user] of [[1, employee], [1, supervisor], [0, manager]] as const) {
      const department = departments[index];
      await admin.call("config.assignOrganizationMember", { unitId: department.id, userId: user.id, isPrimary: true, onlyIfAbsent: true }, true);
      department.userIds.push(user.id);
    }
    const teamListing = await admin.call("config.organizationMembersPage", { unitId: team.id });
    assert.equal(teamListing.total, 2);
    record.organization = { departments: 2, primaryMemberships: 3, teamMembers: teamListing.total };
    const project = await admin.call("project.create", { code: projectCode, name: "流程发布验收样例", description: "工单、请假与订单汇总的合成业务。" }, true);
    projectId = project.id;
    for (const user of [employee, supervisor, manager])
      await admin.call("project.grantMember", { projectId, userId: user.id, role: "operator" }, true);
    const state = await publish("state", "员工请假审批", createLeaveApprovalDefinition());
    const control = await publish("control", "工单并行复核", controlDefinition(supervisor.id, manager.id));
    const assetSource = await admin.call("data.createSource", { projectId, name: "合成订单源", sourceType: "inline", connection: {} }, true);
    const data = await admin.call("data.createAsset", { projectId, sourceId: assetSource.id, name: "订单样本",
      assetType: "dataset", schema: [{ name: "region", type: "string" }, { name: "status", type: "string" }, { name: "amount", type: "number" }],
      sample: [
        { region: "华东", status: "已付款", amount: 120 }, { region: "华东", status: "已付款", amount: 80 },
        { region: "华南", status: "已付款", amount: 60 }, { region: "华南", status: "已取消", amount: 900 },
      ] }, true);
    const analytics = await publish("data", "订单质量与金额汇总", dataDefinition(data.id));
    await assert.rejects(observer.client.call("workflow.get", { id: control.id }), { status: 404 });
    await admin.call("project.grantMember", { projectId, userId: observer.id, role: "viewer" }, true);
    assert.equal((await observer.client.call("workflow.get", { id: control.id })).id, control.id);
    await assert.rejects(observer.client.call("workflow.run", { workflowId: control.id }, true), { status: 403 });
    await admin.call("project.revokeMember", { projectId, userId: observer.id }, true);
    await assert.rejects(observer.client.call("workflow.get", { id: control.id }), { status: 404 });
    record.access = { isolatedRole: true, readOnlyRole: true, refreshedRevocation: true };

    const stateStart = await employee.client.call("workflow.run", { workflowId: state.id, input: { leaveReason: "示例年假申请" } }, true);
    workflowRuns.push(stateStart.runId);
    const direct = await oneTask(supervisor.client, stateStart.runId, "supervisor-approve");
    await approve(supervisor.client, direct.id);
    const levelTwo = await oneTask(manager.client, stateStart.runId, "manager-approve");
    await approve(manager.client, levelTwo.id);
    const stateRun = await until(() => detail(stateStart.runId), row => terminal(row?.status), "请假审批");
    assert.equal(stateRun.status, "success");
    assert(stateRun.nodeRuns.some((step: any) => step.nodeId === "manager-approve" && step.status === "success"));
    assert.equal((await supervisor.client.call("task.list", { view: "done", projectId, runId: stateStart.runId })).length, 1);
    const personal = await publish("state", "事项撤回与换人", createParticipantStateExample());
    const personalRun = await employee.client.call("workflow.run", { workflowId: personal.id }, true);
    workflowRuns.push(personalRun.runId);
    const operate = (client: Session, taskId: string, outcome: string, receiverUserId?: number) =>
      client.call("task.execute", { taskId, result: { decision: "approved", outcome, ...(receiverUserId ? { receiverUserId } : {}) } }, true);
    const submission = await oneTask(employee.client, personalRun.runId, "submit");
    await operate(employee.client, submission.id, "submit", supervisor.id);
    const oldTask = await oneTask(supervisor.client, personalRun.runId, "handle");
    const cardStates = async () => Object.fromEntries((await detail(personalRun.runId)).participantCards.map((card: any) => [card.userId, card.stateName]));
    assert.deepEqual(await cardStates(), { [employee.id]: "已提交", [supervisor.id]: "待处理" });
    await supervisor.client.call("task.claim", { taskId: oldTask.id }, true);
    const withdrawal = await oneTask(employee.client, personalRun.runId, "withdraw");
    await operate(employee.client, withdrawal.id, "withdraw");
    assert.deepEqual(await cardStates(), { [employee.id]: "已撤回待提交", [supervisor.id]: "下级已撤回" });
    await assert.rejects(supervisor.client.call("task.complete", { taskId: oldTask.id, result: { decision: "approved", outcome: "handle" } }, true));
    assert.equal((await operate(employee.client, withdrawal.id, "withdraw")).deduplicated, true);
    const retry = await oneTask(employee.client, personalRun.runId, "submit");
    await operate(employee.client, retry.id, "submit", manager.id);
    const replacement = await oneTask(manager.client, personalRun.runId, "handle");
    assert.notEqual(replacement.id, oldTask.id);
    await operate(manager.client, replacement.id, "handle");
    const finalCards = await until(() => detail(personalRun.runId), row => terminal(row?.status), "事项换人办理");
    assert.equal(finalCards.status, "success");
    record.flows = { state: { status: stateRun.status, approvals: 2, nodeRuns: stateRun.nodeRuns.length,
      personalState: { status: finalCards.status, cardCount: finalCards.participantCards.length, withdrawnTaskInvalidated: true, replayDeduplicated: true } } };

    const start = await employee.client.call("workflow.run", { workflowId: control.id }, true);
    workflowRuns.push(start.runId);
    const service = await oneTask(supervisor.client, start.runId, "service");
    const finance = await oneTask(manager.client, start.runId, "finance");
    await until(() => detail(start.runId), row => row?.status === "waiting", "并行人工等待");
    await assert.rejects(observer.client.call("workflow.runDetail", { runId: start.runId }), { status: 404 });
    await admin.call("workflow.pauseRun", { runId: start.runId }, true);
    await until(() => detail(start.runId), row => row?.status === "blocked", "暂停实例");
    await assert.rejects(approve(supervisor.client, service.id), { status: 409 });
    await admin.call("workflow.resumeRun", { runId: start.runId }, true);
    await approve(supervisor.client, service.id);
    const midway = await until(() => detail(start.runId), row => row?.status === "waiting" &&
      row.nodeRuns.some((step: any) => step.nodeId === "service" && step.status === "success"), "只完成第一条并行分支");
    assert(!midway.nodeRuns.some((step: any) => step.nodeId === "merge" && step.status === "success"));
    assert((await manager.client.call("task.list", { view: "todo", runId: start.runId })).some((item: any) => item.id === finance.id));
    await approve(manager.client, finance.id);
    const controlRun = await until(() => detail(start.runId), row => terminal(row?.status), "并行汇聚");
    assert.equal(controlRun.status, "success");
    assert.equal(controlRun.nodeRuns.filter((step: any) => step.nodeId === "merge" && step.status === "success").length, 1);
    const cancelled = await employee.client.call("workflow.run", { workflowId: control.id }, true);
    workflowRuns.push(cancelled.runId);
    await until(() => detail(cancelled.runId), row => row?.status === "waiting", "取消前待办");
    await admin.call("workflow.cancelRun", { runId: cancelled.runId }, true);
    assert.equal((await detail(cancelled.runId)).status, "cancelled");
    assert.equal((await supervisor.client.call("task.list", { view: "todo", runId: cancelled.runId })).length, 0);
    const input = { businessKey: "00123", amount: 10, config: { enabled: true } };
    const message = await publish("control", "消息业务编号_" + tag, messageDefinition(), input);
    const messageRun = await employee.client.call("workflow.run", { workflowId: message.id, input }, true);
    workflowRuns.push(messageRun.runId);
    const waitingMessage = await until(() => detail(messageRun.runId), row => row?.status === "waiting", "订单消息挂起");
    assert.deepEqual(typeof waitingMessage.inputJson === "string" ? JSON.parse(waitingMessage.inputJson) : waitingMessage.inputJson, input);
    await admin.call("task.signalMessage", { runId: messageRun.runId, messageName: "order.paid",
      correlationKey: input.businessKey, payload: { accepted: true } }, true);
    const signalled = await until(() => detail(messageRun.runId), row => terminal(row?.status), "订单消息恢复");
    assert.equal(signalled.status, "success");
    assert.equal(signalled.nodeRuns.filter((step: any) => step.nodeId === "end" && step.status === "success").length, 1);
    record.flows = { ...record.flows, control: { status: controlRun.status, parallelReviews: 2, mergeCount: 1,
      pauseResume: true, cancelInvalidatesTask: true, typedInputAndMessageResume: true } };

    const dataset = await admin.call("data.run", { projectId, workflowId: analytics.id }, true);
    dataRuns.push(dataset.runId);
    const completed = await until(() => dataDetail(dataset.runId), row => terminal(row?.status), "订单汇总");
    assert.equal(completed.status, "success", JSON.stringify(completed.error));
    const rows = completed.output.terminals[0].rows;
    assert.deepEqual(rows, [
      { region: "华东", orderCount: 2, total: 200 }, { region: "华南", orderCount: 1, total: 60 },
    ]);
    const lineage = await admin.call("data.runLineage", { projectId, runId: dataset.runId });
    assert(lineage.artifacts.some((item: any) => item.nodeId === "aggregate" && Number(item.rowCount) === 2));
    const multiple = await publish("data", "订单多结果集", multipleResultsDefinition(data.id));
    const multipleRun = await admin.call("data.run", { projectId, workflowId: multiple.id, data: input }, true);
    dataRuns.push(multipleRun.runId);
    const results = await until(() => dataDetail(multipleRun.runId), row => terminal(row?.status), "多个数据结果集");
    assert.equal(results.status, "success");
    assert.deepEqual(results.input, input);
    assert.equal(results.output.terminals.length, 2);
    const regions = results.output.terminals.find((item: any) => item.nodeName === "地区结果");
    const amounts = results.output.terminals.find((item: any) => item.outputName === "金额明细");
    assert.deepEqual(regions?.rows, ["华东", "华东", "华南", "华南"].map(region => ({ region })));
    assert.deepEqual(amounts?.rows, [120, 80, 60, 900].map(amount => ({ amount })));
    record.flows = { ...record.flows, data: { status: completed.status, rows, lineageArtifacts: lineage.artifacts.length,
      resultSets: [regions.nodeName, amounts.outputName] } };

    const from = new Date(Date.now() - 3_600_000), to = new Date(Date.now() + 60_000);
    const checks = [
      ["project.page", { search: projectCode, createdFrom: from.toISOString(), createdBefore: to.toISOString() }, projectId],
      ["task.page", { view: "done", runId: stateStart.runId, createdAtFrom: from, createdAtBefore: to }, direct.id],
      ["task.instancePage", { view: "all", search: control.name, createdAtFrom: from, createdAtBefore: to }, start.runId],
      ["workflow.runHistoryPage", { workflowId: control.id, from, to }, start.runId],
      ["data.runPage", { projectId, workflowId: analytics.id, createdFrom: from, createdBefore: to }, dataset.runId],
    ] as const;
    const timeFilters: Record<string, boolean> = {};
    for (const [procedure, input, id] of checks) {
      const client = procedure === "task.page" ? supervisor.client : admin;
      const page = await client.call(procedure, input);
      timeFilters[procedure] = (page.items ?? page.rows ?? []).some((item: any) => (item.id ?? item.runId) === id);
    }
    record.timeFilters = timeFilters;
    assert(Object.values(timeFilters).every(Boolean), JSON.stringify(timeFilters));
    if (capture) await capture({ projectId: projectId!, state: { workflowId: state.id, runId: stateStart.runId, name: state.name },
      control: { workflowId: control.id, runId: start.runId, name: control.name },
      data: { workflowId: analytics.id, runId: dataset.runId, name: analytics.name },
      results: { workflowId: multiple.id, runId: multipleRun.runId, name: multiple.name }, messageWorkflowId: message.id });
    await admin.call("iam.updateUserStatus", { userId: observer.id, status: "disabled" }, true);
    await assert.rejects(new Session(base).call("auth.login", observer.login, true), { status: 401 });
    record.access = { ...record.access, disabledLoginDenied: true };
  } finally {
    try {
      for (const runId of workflowRuns)
        if (!terminal((await detail(runId)).status)) await admin.call("workflow.cancelRun", { runId }, true);
      for (const runId of dataRuns)
        if (!terminal((await dataDetail(runId)).status)) await admin.call("data.cancelRun", { projectId, runId, reason: "结束发布验收" }, true);
      if (projectId) {
        const current = await admin.call("project.lifecyclePreview", { projectId });
        assert.equal(current.code, projectCode);
        await admin.call("project.changeStatus", { projectId, status: "archived", expectedVersion: current.lifecycleVersion,
          expectedWorkflowCount: current.workflowCount }, true);
      }
      for (const department of departments.reverse()) {
        for (const userId of department.userIds)
          await admin.call("config.removeOrganizationMember", { unitId: department.id, userId }, true);
        await admin.call("config.updateOrganizationUnit", { id: department.id, managerUserId: null, status: "disabled" }, true);
      }
      for (const user of members) {
        await user.client.call("auth.logout", null, true);
        await admin.call("iam.updateUserStatus", { userId: user.id, status: "disabled" }, true);
      }
      record.cleanup = { fixtureProjectArchived: Boolean(projectId), disabledAccounts: members.length, disabledDepartments: departments.length };
    } catch (error) { cleanupError = error; }
    await admin.call("auth.logout", null, true);
    if (cleanupError) throw cleanupError;
  }
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await runProductAcceptance(), null, 2));
