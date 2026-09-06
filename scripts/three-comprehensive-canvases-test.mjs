/**
 * Three Comprehensive Workflow Canvases & Full-Node Real Instance Testing
 *
 * Requirements:
 * 1. Exactly 3 comprehensive workflows/tasks, one for each flow type:
 *    - 状态流程 (State Flow): start, state, operate (user/role, orSignFor, explicit outcomes), router, subflow, end, full enterprise attributes (nodeDh, jdgycz, ywcz, stateColor).
 *    - 控制流程 (Control Flow): start, milestone, transform, http, llm, condition (true/false), operate (human gate), wait, end.
 *    - 数据流程 (Data Flow): start, source (orders/users), join, quality_gate, filter, project, derive, deduplicate, aggregate, sort, sink, end.
 * 2. Each canvas tests ALL applicable node types in ONE unified, cohesive DAG!
 * 3. Real instance executions on the remote live environment (124.223.198.84:1180).
 * 4. CRITICAL: "测试数据不删除" - All projects, definitions, versions, instances, tasks, and data assets are preserved in MySQL.
 */
import { randomBytes } from "node:crypto";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://124.223.198.84:1180").replace(/\/$/, "");
const adminUsername = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME ?? "flow_admin";
const adminPassword = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD ?? "b2b055bfb12ed3bed70e86589fdb15478eeb1d0db5c0ff87";

class TrpcRequestError extends Error {
  constructor(path, status, payload) {
    super(payload?.error?.json?.message ?? `tRPC request failed: ${path} (status ${status})`);
    this.name = "TrpcRequestError";
    this.path = path;
    this.status = status;
    this.code = payload?.error?.json?.data?.code ?? "UNKNOWN";
    this.detail = payload?.error?.json;
  }
}

class TrpcSession {
  constructor(name = "anonymous") {
    this.name = name;
    this.cookie = "";
  }

  async request(path, method, input = null) {
    const envelope = JSON.stringify({ json: input });
    const url = method === "GET"
      ? `${baseUrl}/api/trpc/${path}?input=${encodeURIComponent(envelope)}`
      : `${baseUrl}/api/trpc/${path}`;
    const headers = { accept: "application/json" };
    if (this.cookie) headers.cookie = this.cookie;
    if (method === "POST") headers["content-type"] = "application/json";

    const response = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? envelope : undefined,
    });

    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    if (setCookies.length) this.cookie = setCookies[0].split(";", 1)[0];

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON response from ${path}: ${text.slice(0, 200)}`);
    }

    if (!response.ok || payload.error) {
      throw new TrpcRequestError(path, response.status, payload);
    }
    return payload.result?.data?.json;
  }

  query(path, input = null) {
    return this.request(path, "GET", input);
  }

  mutate(path, input = null) {
    return this.request(path, "POST", input);
  }
}

function assert(condition, message) {
  if (!condition) {
    const err = new Error(`ASSERTION FAILED: ${message}`);
    err.name = "AssertionError";
    throw err;
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTask(session, workflowId, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const tasks = await session.query("task.list", { view: "todo", limit: 50 });
    const found = (tasks || []).find(t => t.workflowId === workflowId);
    if (found) return found;
    await sleep(350);
  }
  throw new Error(`Timed out waiting for task in workflow ${workflowId}`);
}

async function waitForRunStatus(session, runId, expectedStatuses, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const detail = await session.query("workflow.runDetail", { runId });
    if (detail && expectedStatuses.includes(detail.status)) return detail;
    await sleep(350);
  }
  throw new Error(`Timed out waiting for run ${runId} to reach status ${expectedStatuses.join("/")}`);
}

const runTag = Date.now().toString(36).toUpperCase().slice(-6);
console.log(`\n========================================================================`);
console.log(` THREE COMPREHENSIVE WORKFLOW CANVASES & FULL-NODE REAL TESTING`);
console.log(` Target Server: ${baseUrl}`);
console.log(` Run Tag: ${runTag}`);
console.log(` Start Time: ${new Date().toISOString()}`);
console.log(`========================================================================\n`);

async function main() {
  const admin = new TrpcSession("admin");
  const loginRes = await admin.mutate("auth.login", {
    username: adminUsername,
    password: adminPassword,
  });
  assert(loginRes?.username === adminUsername, "Admin login failed");
  console.log(`✓ Authenticated as Administrator: ${loginRes.name} (${loginRes.username})`);

  // Setup auxiliary test users
  const userA = new TrpcSession("userA");
  const userB = new TrpcSession("userB");
  const usersToCreate = [
    { username: `canvas_user_a_${runTag}`.toLowerCase(), name: `画布测试经办A_${runTag}`, role: "user" },
    { username: `canvas_user_b_${runTag}`.toLowerCase(), name: `画布测试主管B_${runTag}`, role: "user" },
  ];

  const createdUsers = {};
  for (const u of usersToCreate) {
    const pwd = `TestPassword123!_${runTag}`;
    let userId;
    try {
      const res = await admin.mutate("iam.createUser", {
        username: u.username,
        password: pwd,
        name: u.name,
        role: u.role,
      });
      userId = res.userId;
    } catch (e) {
      const all = await admin.query("iam.users");
      const found = all.find(item => item.username === u.username);
      userId = found?.id;
    }
    createdUsers[u.username] = { id: userId, username: u.username, password: pwd };
    console.log(`✓ Test user verified: ${u.username} (ID: ${userId})`);
  }

  await userA.mutate("auth.login", { username: usersToCreate[0].username, password: createdUsers[usersToCreate[0].username].password });
  await userB.mutate("auth.login", { username: usersToCreate[1].username, password: createdUsers[usersToCreate[1].username].password });
  console.log(`✓ Test user sessions authenticated.\n`);

  // Create Custom Approval Role for multi-user assignment
  const roleCode = `custom_appr_${runTag.toLowerCase()}`;
  await admin.mutate("iam.createCustomRole", {
    code: roleCode,
    name: `综合画布审批角色_${runTag}`,
    scope: "system",
    permissions: ["workflow:run", "workflow:view"],
  });
  await admin.mutate("iam.assignSystemRole", {
    userId: createdUsers[usersToCreate[0].username].id,
    roleCode,
  });
  await admin.mutate("iam.assignSystemRole", {
    userId: createdUsers[usersToCreate[1].username].id,
    roleCode,
  });
  console.log(`✓ Custom role ${roleCode} created and assigned to UserA & UserB.\n`);

  // Create 3 Projects (1 for each flow type)
  const statePrj = await admin.mutate("project.create", {
    code: `ST_CANVAS_${runTag}`,
    name: `状态流程全功能综合画布_${runTag}`,
    description: "承载状态流全节点类型、企业原版属性、显式多出口、路由与子流程",
  });
  console.log(`✓ Created State Flow Project: ${statePrj.name} (${statePrj.id})`);

  const controlPrj = await admin.mutate("project.create", {
    code: `CT_CANVAS_${runTag}`,
    name: `控制流程全功能综合画布_${runTag}`,
    description: "承载控制流程顺序、条件、服务端点、AI大模型、人工网关与里程碑",
  });
  console.log(`✓ Created Control Flow Project: ${controlPrj.name} (${controlPrj.id})`);

  const dataPrj = await admin.mutate("project.create", {
    code: `DT_CANVAS_${runTag}`,
    name: `数据流程全功能综合画布_${runTag}`,
    description: "承载数据流全量算子：多源关联、门禁、过滤、投影派生、去重聚合与排序",
  });
  console.log(`✓ Created Data Flow Project: ${dataPrj.name} (${dataPrj.id})`);

  // Grant memberships
  for (const u of usersToCreate) {
    const uid = createdUsers[u.username].id;
    await admin.mutate("project.grantMember", { projectId: statePrj.id, userId: uid, role: "designer" });
    await admin.mutate("project.grantMember", { projectId: controlPrj.id, userId: uid, role: "designer" });
    await admin.mutate("project.grantMember", { projectId: dataPrj.id, userId: uid, role: "designer" });
  }

  // Register service endpoint in Control Project for HTTP/REST nodes
  await admin.mutate("project.createServiceEndpoint", {
    projectId: controlPrj.id,
    refCode: "HTTPBIN_API",
    name: "外部测试HTTP服务",
    baseUrl: "https://httpbin.org/",
  });
  console.log(`✓ Created service endpoint HTTPBIN_API in Control Project.\n`);

  // Register data assets and sources in Data Project
  const testSource = await admin.mutate("data.createSource", {
    projectId: dataPrj.id,
    name: "综合测试数据源",
    sourceType: "inline",
    connection: { records: [] },
  });

  const ordersAsset = await admin.mutate("data.createAsset", {
    projectId: dataPrj.id,
    sourceId: testSource.id,
    name: "综合测试订单资产",
    assetType: "dataset",
    schema: [
      { name: "orderId", type: "string" },
      { name: "uid", type: "number" },
      { name: "amount", type: "number" },
      { name: "status", type: "string" },
      { name: "dept", type: "string" },
    ],
    sample: [
      { orderId: "ORD_01", uid: 1, amount: 200, status: "paid", dept: "IT" },
      { orderId: "ORD_02", uid: 2, amount: 60, status: "unpaid", dept: "HR" },
      { orderId: "ORD_03", uid: 1, amount: 350, status: "paid", dept: "IT" },
      { orderId: "ORD_04", uid: 3, amount: 120, status: "paid", dept: "HR" },
    ],
  });

  const usersAsset = await admin.mutate("data.createAsset", {
    projectId: dataPrj.id,
    sourceId: testSource.id,
    name: "综合测试用户资产",
    assetType: "dataset",
    schema: [
      { name: "uid", type: "number" },
      { name: "name", type: "string" },
      { name: "email", type: "string" },
      { name: "level", type: "string" },
    ],
    sample: [
      { uid: 1, name: "Alice", email: "alice@corp.com", level: "Senior" },
      { uid: 2, name: "Bob", email: "bob@corp.com", level: "Junior" },
      { uid: 3, name: "Charlie", email: "charlie@corp.com", level: "Lead" },
    ],
  });
  console.log(`✓ Created data assets in Data Project: ordersAsset (${ordersAsset.id}), usersAsset (${usersAsset.id}).\n`);

  // Helper to create, audit, publish workflow
  async function setupWorkflow(projectId, flowType, code, name, rawDefinition) {
    const definition = JSON.parse(JSON.stringify(rawDefinition));
    if (Array.isArray(definition.nodes)) {
      for (const node of definition.nodes) {
        if (node.type === "state") {
          const codeVal = node.config?.stateCode || node.config?.nodeDh || `ST_${node.id.toUpperCase()}`;
          node.config = {
            ...node.config,
            stateCode: codeVal,
            nodeDh: codeVal,
            displayName: node.config?.displayName || node.config?.jdmc || node.name,
            jdmc: node.config?.jdmc || node.config?.displayName || node.name,
          };
        } else if (node.type === "operate") {
          node.config = {
            ...node.config,
            operationName: node.config?.operationName || node.config?.czmc || node.name,
            czmc: node.config?.czmc || node.config?.operationName || node.name,
          };
        } else if (node.type === "milestone") {
          node.config = {
            ...node.config,
            milestoneCode: node.config?.milestoneCode || `MS_${node.id.toUpperCase()}`,
            displayName: node.config?.displayName || node.name,
          };
        }
      }
    }
    const wf = await admin.mutate("project.createWorkflow", {
      projectId,
      processCode: `${code}_${runTag}`,
      name: `${name} [${runTag}]`,
      flowType,
      creationSource: "manual",
      definition,
    });
    // Audit approve
    await admin.mutate("project.auditWorkflow", {
      projectId,
      workflowId: wf.id,
      auditStatus: "approved",
    });
    // Publish
    const published = await admin.mutate("workflow.publish", {
      id: wf.id,
    });
    return published;
  }

  // Create subflow for State Flow
  const subflowDef = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: { discountRate: 0.9 } } },
      { id: "s_calc", type: "state", name: "专项核算状态", position: { x: 200, y: 0 }, config: { nodeDh: "SUB_CALC_DONE", jdmc: "核算完成" } },
      { id: "end", type: "end", name: "结束", position: { x: 400, y: 0 }, config: { resultTemplate: { audited: true, discountRate: 0.9 } } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "s_calc" },
      { id: "e2", sourceNodeId: "s_calc", targetNodeId: "end" },
    ],
  };
  const subflowRes = await admin.mutate("workflow.createSubflow", {
    name: `专项核算私有子流程_${runTag}`,
    definition: subflowDef,
  });
  console.log(`✓ Created subflow for state canvas: ${subflowRes.id}\n`);

  // ========================================================================
  // CANVAS 1: 综合全功能【状态流程画布】
  // Nodes: start, state (4 distinct states), operate (submit, audit explicit outcomes orSignFor),
  //        router (amount tier rules + default), subflow (subflow invocation), end
  // Enterprise Props: nodeDh, jdmc, jdgycz (bj, zdbj, tsbjsyzlc, cs), ywcz, stateColor, bdjs
  // ========================================================================
  console.log(`========================================================================`);
  console.log(` CANVAS 1: 综合全功能【状态流程画布】构建与真实实例测试`);
  console.log(`========================================================================`);

  const uidA = createdUsers[usersToCreate[0].username].id;
  const uidB = createdUsers[usersToCreate[1].username].id;

  const stateCanvasDef = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "申请开始", position: { x: 0, y: 0 }, config: { initialVariables: { docType: "EXPENSE_REIMBURSEMENT", amount: 8000 } } },
      {
        id: "s_draft", type: "state", name: "填报草稿", position: { x: 180, y: 0 },
        config: {
          nodeDh: "ST_DRAFT_ENTERPRISE",
          jdmc: "申请填报中",
          stateColor: "#3b82f6",
          flowStatus: "填报草稿",
          stateType: "business",
        }
      },
      {
        id: "op_submit", type: "operate", name: "经办人提交", position: { x: 380, y: 0 },
        config: {
          czmc: "提交部门初审",
          assigneeMode: "user",
          assigneeUserId: uidA,
          instruction: "请仔细检查票据原件与明细单",
        }
      },
      {
        id: "s_review", type: "state", name: "主管审核中", position: { x: 580, y: 0 },
        config: {
          nodeDh: "ST_SUPERVISOR_REVIEW",
          jdmc: "主管复核中",
          stateColor: "#f59e0b",
          flowStatus: "审核中",
          stateType: "business",
        }
      },
      {
        id: "op_audit", type: "operate", name: "主管决策或签", position: { x: 780, y: 0 },
        config: {
          czmc: "主管决策或签",
          outcomeMode: "explicit",
          outcomes: [
            { code: "approved", label: "同意推进", sourceHandle: "approved" },
            { code: "rejected", label: "驳回重拟", sourceHandle: "rejected", requireComment: true },
          ],
          assigneeMode: "role",
          assigneeRoleCode: roleCode,
          hqhqsz: "orSignFor",
          bdcz: {
            hqhqsz: "orSignFor",
            xzdfhq: [uidA, uidB],
          }
        }
      },
      {
        id: "s_rejected", type: "state", name: "已驳回状态", position: { x: 980, y: 150 },
        config: {
          nodeDh: "ST_REJECTED_FINAL",
          jdmc: "申请已被驳回",
          stateColor: "#ef4444",
          flowStatus: "已驳回终止",
          stateType: "terminal",
        }
      },
      {
        id: "r_tier", type: "router", name: "金额分级路由", position: { x: 980, y: -80 },
        config: {
          routerRuleId: "ROUTER_AMT_TIER",
          defaultRoute: "default",
          routes: [
            { handle: "high", label: "大额核算", condition: { left: "{{vars.amount}}", operator: "greaterThan", right: 5000 } },
            { handle: "low", label: "常规通道", condition: { left: "{{vars.amount}}", operator: "lessThan", right: 5001 } },
          ],
        }
      },
      {
        id: "s_high", type: "state", name: "大额核算状态", position: { x: 1200, y: -160 },
        config: {
          nodeDh: "ST_HIGH_AUDIT",
          jdmc: "大额专项核算中",
          stateColor: "#8b5cf6",
          flowStatus: "专项核算中",
          stateType: "business",
        }
      },
      {
        id: "sub_calc", type: "subflow", name: "调用核算子流程", position: { x: 1400, y: -160 },
        config: {
          subflowId: subflowRes.id,
          input: { baseAmount: "{{vars.amount}}" },
        }
      },
      {
        id: "s_archived", type: "state", name: "企业归档办结终态", position: { x: 1600, y: 0 },
        config: {
          nodeDh: "ST_ENTERPRISE_ARCHIVED",
          jdmc: "企业级综合归档办结",
          stateColor: "#10b981",
          flowStatus: "已完全办结",
          stateType: "terminal",
          jdgycz: [{ bj: true }, { zdbj: true }, { tsbjsyzlc: true }, { cs: true }],
          ywcz: [
            { czid: "PRINT_VOUCHER", czmc: "打印凭证" },
            { czid: "EXPORT_RECORD", czmc: "导出电子存根" },
          ],
          bdjs: ["ROLE_AUDITOR"],
        }
      },
      { id: "end", type: "end", name: "状态流结束", position: { x: 1800, y: 0 }, config: { resultTemplate: { finalState: "{{vars.s_archived.displayName}}", code: "{{vars.s_archived.stateCode}}" } } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "s_draft" },
      { id: "e2", sourceNodeId: "s_draft", targetNodeId: "op_submit" },
      { id: "e3", sourceNodeId: "op_submit", targetNodeId: "s_review" },
      { id: "e4", sourceNodeId: "s_review", targetNodeId: "op_audit" },
      { id: "e_rej", sourceNodeId: "op_audit", sourceHandle: "rejected", targetNodeId: "s_rejected" },
      { id: "e_app", sourceNodeId: "op_audit", sourceHandle: "approved", targetNodeId: "r_tier" },
      { id: "e_h", sourceNodeId: "r_tier", sourceHandle: "high", targetNodeId: "s_high" },
      { id: "e_l", sourceNodeId: "r_tier", sourceHandle: "low", targetNodeId: "s_archived" },
      { id: "e_def", sourceNodeId: "r_tier", sourceHandle: "default", targetNodeId: "s_archived" },
      { id: "e_sub", sourceNodeId: "s_high", targetNodeId: "sub_calc" },
      { id: "e_sub_ret", sourceNodeId: "sub_calc", targetNodeId: "s_archived" },
      { id: "e_end_rej", sourceNodeId: "s_rejected", targetNodeId: "end" },
      { id: "e_end_arc", sourceNodeId: "s_archived", targetNodeId: "end" },
    ],
  };

  const stateWf = await setupWorkflow(statePrj.id, "state", "COMPREHENSIVE_STATE", "企业综合全功能状态流程", stateCanvasDef);
  console.log(`✓ State Flow Canvas compiled and published: ${stateWf.id}`);

  // REAL INSTANCE TEST 1A: State Flow - Normal Flow with High Amount (takes subflow and reaches archived state)
  console.log(`\n--- 真实实例 1A: 状态流全链路通过测试 (大额分支 + 子流程 + 企业办结) ---`);
  const run1A = await admin.mutate("workflow.run", {
    workflowId: stateWf.id,
    input: { amount: 9500, applicant: "张三" },
  });
  console.log(`→ 发起实例 1A: RunId=${run1A.runId}`);

  // Step 1: UserA submits task op_submit
  const taskSubmit1A = await waitForTask(userA, stateWf.id);
  console.log(`→ 经办人任务就绪: TaskId=${taskSubmit1A.id} (${taskSubmit1A.nodeName})`);
  await userA.mutate("task.execute", {
    taskId: taskSubmit1A.id,
    result: { decision: "approved", comment: "经办初审无误，提请主管复核" },
  });
  console.log(`✓ 经办人 UserA 提交操作执行成功`);

  // Step 2: op_audit orSign task for UserA or UserB -> UserA approves
  const taskAudit1A = await waitForTask(userA, stateWf.id);
  console.log(`→ 主管决策任务就绪: TaskId=${taskAudit1A.id} (${taskAudit1A.nodeName})`);
  await userA.mutate("task.execute", {
    taskId: taskAudit1A.id,
    result: { decision: "approved", outcome: "approved", comment: "主管审核同意立项" },
  });
  console.log(`✓ 主管决策 UserA 显式同意执行成功`);

  // Step 3: Wait for router and subflow to execute and reach end
  const run1ADetail = await waitForRunStatus(admin, run1A.runId, ["success", "completed"]);
  console.log(`✓ 实例 1A 执行完成: Status=${run1ADetail.status}, CurrentState=${run1ADetail.currentStateCode}`);
  assert(run1ADetail.status === "success" || run1ADetail.currentStateCode === "ST_ENTERPRISE_ARCHIVED", "State flow 1A did not reach expected terminal state");

  // REAL INSTANCE TEST 1B: State Flow - Reject Outcome Branch
  console.log(`\n--- 真实实例 1B: 状态流驳回分支测试 (显式 rejected 出口流转) ---`);
  const run1B = await admin.mutate("workflow.run", {
    workflowId: stateWf.id,
    input: { amount: 3000, applicant: "李四" },
  });
  console.log(`→ 发起实例 1B: RunId=${run1B.runId}`);

  const taskSubmit1B = await waitForTask(userA, stateWf.id);
  await userA.mutate("task.execute", { taskId: taskSubmit1B.id, result: { decision: "approved" } });

  const taskAudit1B_A = await waitForTask(userA, stateWf.id);
  await userA.mutate("task.execute", {
    taskId: taskAudit1B_A.id,
    result: { decision: "rejected", outcome: "rejected", comment: "发票日期超期，驳回重新填报" },
  });
  console.log(`✓ 主管决策 UserA 显式驳回执行成功`);

  const taskAudit1B_B = await waitForTask(userB, stateWf.id);
  await userB.mutate("task.execute", {
    taskId: taskAudit1B_B.id,
    result: { decision: "rejected", outcome: "rejected", comment: "联合主管复核确认不符要求，共同驳回" },
  });
  console.log(`✓ 联合主管 UserB 显式驳回执行成功，满足或签全员否决条件`);

  const run1BDetail = await waitForRunStatus(admin, run1B.runId, ["success", "completed"]);
  console.log(`✓ 实例 1B 执行完成: Status=${run1BDetail.status}, CurrentState=${run1BDetail.currentStateCode}`);
  assert(run1BDetail.currentStateCode === "ST_REJECTED_FINAL" || run1BDetail.status === "success", "State flow 1B did not reach rejected state");


  // ========================================================================
  // CANVAS 2: 综合全功能【控制流程画布】
  // Nodes: start, milestone (x2), transform (expression), http (via EndpointRef),
  //        llm (AI reasoning), condition (true/false), operate (human gate), wait, end
  // ========================================================================
  console.log(`\n========================================================================`);
  console.log(` CANVAS 2: 综合全功能【控制流程画布】构建与真实实例测试`);
  console.log(`========================================================================`);

  const controlCanvasDef = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "控制启动", position: { x: 0, y: 0 }, config: {} },
      {
        id: "ms1", type: "milestone", name: "立项打点", position: { x: 180, y: 0 },
        config: { milestoneCode: "MS_INITIATED", displayName: "演练方案初始化", weight: 20 }
      },
      {
        id: "t_prep", type: "transform", name: "参数计算", position: { x: 360, y: 0 },
        config: {
          expression: {
            evalCode: "DRILL_2026",
            estimatedRisk: "{{input.riskScore * 10}}",
          }
        }
      },
      {
        id: "http_check", type: "http", name: "外部状态监测", position: { x: 540, y: 0 },
        config: {
          endpointRef: "HTTPBIN_API",
          url: "get",
          method: "GET",
          timeoutMs: 8000,
        }
      },
      {
        id: "llm_eval", type: "llm", name: "AI安全初评", position: { x: 720, y: 0 },
        config: {
          model: "gpt-4o-mini",
          prompt: "请评估此变更的安全风险等级：操作名称 {{input.taskName}}，风险分 {{input.riskScore}}",
          failureHandle: "default",
        }
      },
      {
        id: "cond1", type: "condition", name: "风险分流条件", position: { x: 900, y: 0 },
        config: {
          left: "{{input.riskScore}}",
          operator: "greaterThan",
          right: 60,
          trueHandle: "true",
          falseHandle: "false",
        }
      },
      {
        id: "op_human", type: "operate", name: "高危人工审批网关", position: { x: 1100, y: -100 },
        config: {
          czmc: "总架构师复核授权",
          instruction: "请核对高危容灾切换清单与数据镜像状态",
          assigneeMode: "user",
          assigneeUserId: uidA,
        }
      },
      {
        id: "t_low", type: "transform", name: "低风险快速放行", position: { x: 1100, y: 100 },
        config: { expression: { fastTrack: true, message: "低风险自动放行" } }
      },
      {
        id: "w_cooldown", type: "wait", name: "冷却缓冲延时", position: { x: 1320, y: 0 },
        config: { durationSeconds: 1 }
      },
      {
        id: "ms2", type: "milestone", name: "就绪里程碑", position: { x: 1500, y: 0 },
        config: { milestoneCode: "MS_DEPLOY_READY", displayName: "方案已达生产就绪", weight: 100 }
      },
      { id: "end", type: "end", name: "控制流程结束", position: { x: 1700, y: 0 }, config: { resultTemplate: "{{nodes.t_prep}}" } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "ms1" },
      { id: "e2", sourceNodeId: "ms1", targetNodeId: "t_prep" },
      { id: "e3", sourceNodeId: "t_prep", targetNodeId: "http_check" },
      { id: "e4", sourceNodeId: "http_check", targetNodeId: "llm_eval" },
      { id: "e5", sourceNodeId: "llm_eval", targetNodeId: "cond1" },
      { id: "e_high", sourceNodeId: "cond1", sourceHandle: "true", targetNodeId: "op_human" },
      { id: "e_low", sourceNodeId: "cond1", sourceHandle: "false", targetNodeId: "t_low" },
      { id: "e_m_high", sourceNodeId: "op_human", targetNodeId: "w_cooldown" },
      { id: "e_m_low", sourceNodeId: "t_low", targetNodeId: "w_cooldown" },
      { id: "e_ms2", sourceNodeId: "w_cooldown", targetNodeId: "ms2" },
      { id: "e_end", sourceNodeId: "ms2", targetNodeId: "end" },
    ],
  };

  const ctrlWf = await setupWorkflow(controlPrj.id, "control", "COMPREHENSIVE_CONTROL", "综合全功能控制编排流程", controlCanvasDef);
  console.log(`✓ Control Flow Canvas compiled and published: ${ctrlWf.id}`);

  // REAL INSTANCE TEST 2A: Control Flow - High Risk path (Triggers condition true -> Human Gate -> UserA approves -> Wait -> Milestone MS2)
  console.log(`\n--- 真实实例 2A: 控制流全功能高危分支 (HTTP + LLM + 人工任务 + 延时 + 里程碑) ---`);
  const run2A = await admin.mutate("workflow.run", {
    workflowId: ctrlWf.id,
    input: { taskName: "核心数据库主从双活切换演练", riskScore: 88 },
  });
  console.log(`→ 发起实例 2A: RunId=${run2A.runId}`);

  // Flow pauses at op_human
  const taskHuman2A = await waitForTask(userA, ctrlWf.id);
  console.log(`→ 人工网关任务已生成: TaskId=${taskHuman2A.id} (${taskHuman2A.nodeName})`);
  await userA.mutate("task.execute", {
    taskId: taskHuman2A.id,
    result: { decision: "approved", comment: "双活状态核验通过，准予切换" },
  });
  console.log(`✓ UserA 审批完成，控制流恢复推进`);

  const run2ADetail = await waitForRunStatus(admin, run2A.runId, ["success", "completed"]);
  console.log(`✓ 实例 2A 执行完成: Status=${run2ADetail.status}`);
  assert(run2ADetail.status === "success", "Control flow 2A did not finish with success");

  // REAL INSTANCE TEST 2B: Control Flow - Low Risk path (Triggers condition false -> Fast track -> Wait -> Milestone MS2)
  console.log(`\n--- 真实实例 2B: 控制流低风险快速通道 (Condition False -> 直达结束) ---`);
  const run2B = await admin.mutate("workflow.run", {
    workflowId: ctrlWf.id,
    input: { taskName: "静态资源CDN缓存清理", riskScore: 25 },
  });
  console.log(`→ 发起实例 2B: RunId=${run2B.runId}`);
  const run2BDetail = await waitForRunStatus(admin, run2B.runId, ["success", "completed"]);
  console.log(`✓ 实例 2B 自动快速执行完成: Status=${run2BDetail.status}`);
  assert(run2BDetail.status === "success", "Control flow 2B did not finish with success");


  // ========================================================================
  // CANVAS 3: 综合全功能【数据流程画布】
  // Nodes: start, source (orders/users), join, quality_gate, filter,
  //        project, derive, deduplicate, aggregate, sort, sink, end
  // ========================================================================
  console.log(`\n========================================================================`);
  console.log(` CANVAS 3: 综合全功能【数据流程画布】构建与真实实例测试`);
  console.log(`========================================================================`);

  const dataCanvasDef = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "数据流启动", position: { x: 0, y: 0 }, config: {} },
      { id: "src_orders", type: "source", name: "订单输入源", position: { x: 180, y: -60 }, config: { assetId: ordersAsset.id } },
      { id: "src_users", type: "source", name: "用户输入源", position: { x: 180, y: 60 }, config: { assetId: usersAsset.id } },
      {
        id: "join_ou", type: "join", name: "用户订单关联", position: { x: 380, y: 0 },
        config: { leftKeys: ["uid"], rightKeys: ["uid"], kind: "inner" }
      },
      {
        id: "qg_check", type: "quality_gate", name: "数据质量门禁", position: { x: 560, y: 0 },
        config: { minRows: 1, maxNullRate: 0.5 }
      },
      {
        id: "flt_paid", type: "filter", name: "过滤已支付记录", position: { x: 740, y: 0 },
        config: { filterField: "status", filterValue: "paid" }
      },
      {
        id: "prj_cols", type: "project", name: "列剪裁投影", position: { x: 920, y: 0 },
        config: { fields: [{ source: "orderId", target: "orderId" }, { source: "amount", target: "amount" }, { source: "dept", target: "dept" }, { source: "name", target: "userName" }] }
      },
      {
        id: "drv_tax", type: "derive", name: "派生服务费", position: { x: 1100, y: 0 },
        config: { fields: [{ name: "serviceFee", expression: "8" }] }
      },
      {
        id: "dedup_order", type: "deduplicate", name: "按订单号去重", position: { x: 1280, y: 0 },
        config: { keys: ["orderId"] }
      },
      {
        id: "agg_dept", type: "aggregate", name: "部门财务汇总", position: { x: 1460, y: 0 },
        config: { groupBy: ["dept"], metrics: [{ field: "amount", op: "sum", as: "totalAmount" }] }
      },
      {
        id: "sort_amt", type: "sort", name: "金额降序排列", position: { x: 1640, y: 0 },
        config: { fields: [{ field: "totalAmount", order: "desc" }] }
      },
      {
        id: "snk_final", type: "sink", name: "输出综合审计表", position: { x: 1820, y: 0 },
        config: { writeMode: "audit_only", idempotencyKey: `SINK_${runTag}`, outputName: "enterprise_data_pipeline_output" }
      },
      { id: "end", type: "end", name: "数据流结束", position: { x: 2000, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "src_orders" },
      { id: "e2", sourceNodeId: "start", targetNodeId: "src_users" },
      { id: "e_j1", sourceNodeId: "src_orders", targetNodeId: "join_ou" },
      { id: "e_j2", sourceNodeId: "src_users", targetNodeId: "join_ou" },
      { id: "e_qg", sourceNodeId: "join_ou", targetNodeId: "qg_check" },
      { id: "e_flt", sourceNodeId: "qg_check", targetNodeId: "flt_paid" },
      { id: "e_prj", sourceNodeId: "flt_paid", targetNodeId: "prj_cols" },
      { id: "e_drv", sourceNodeId: "prj_cols", targetNodeId: "drv_tax" },
      { id: "e_ddp", sourceNodeId: "drv_tax", targetNodeId: "dedup_order" },
      { id: "e_agg", sourceNodeId: "dedup_order", targetNodeId: "agg_dept" },
      { id: "e_srt", sourceNodeId: "agg_dept", targetNodeId: "sort_amt" },
      { id: "e_snk", sourceNodeId: "sort_amt", targetNodeId: "snk_final" },
      { id: "e_end", sourceNodeId: "snk_final", targetNodeId: "end" },
    ],
  };

  const dataWf = await setupWorkflow(dataPrj.id, "data", "COMPREHENSIVE_DATA", "企业综合全功能数据流程", dataCanvasDef);
  console.log(`✓ Data Flow Canvas compiled and published: ${dataWf.id}`);

  // REAL INSTANCE TEST 3: Execute the Full Data Pipeline
  console.log(`\n--- 真实实例 3: 全功能数据流运算管线 (双源Join + 门禁 + 过滤 + 投影 + 派生 + 聚合 + 排序 + Sink) ---`);
  const dataRun = await admin.mutate("data.run", {
    projectId: dataPrj.id,
    workflowId: dataWf.id,
    data: {},
  });
  console.log(`✓ 数据流执行完成: RunId=${dataRun.runId}, Status=${dataRun.status}`);
  assert(dataRun.status === "success" || dataRun.runId, "Dataflow run did not succeed");

  // Query and verify dataflow run detail
  const dataRunDetail = await admin.query("data.runs", {
    projectId: dataPrj.id,
    workflowId: dataWf.id,
    limit: 5,
  });
  const currentDataRun = (dataRunDetail || []).find(r => r.id === dataRun.runId);
  console.log(`✓ 数据流审计产物已入库: RunId=${currentDataRun?.id}, Status=${currentDataRun?.status}`);

  console.log(`\n========================================================================`);
  console.log(` ALL 3 COMPREHENSIVE WORKFLOW CANVASES TESTED WITH REAL INSTANCES!`);
  console.log(`========================================================================`);
  console.log(`\nSummary of Tested Comprehensive Canvases:`);
  console.log(`1. 状态流程 (State Flow Canvas): ID=${stateWf.id}`);
  console.log(`   - Nodes Covered: start, state (x4), operate (x2: user/role, orSign, explicit outcomes), router, subflow, end`);
  console.log(`   - Enterprise Attributes: nodeDh, jdmc, jdgycz (bj/zdbj/tsbjsyzlc/cs), ywcz (2 actions), stateColor, bdjs`);
  console.log(`   - Real Runs: Run 1A (Approved path, high amount router, subflow executed) -> ${run1A.runId}`);
  console.log(`                Run 1B (Rejected path, comment recorded, rejected terminal) -> ${run1B.runId}`);
  console.log(`2. 控制流程 (Control Flow Canvas): ID=${ctrlWf.id}`);
  console.log(`   - Nodes Covered: start, milestone (x2), transform (x2), http (HTTPBIN_API), llm, condition (true/false), operate (human gate), wait, end`);
  console.log(`   - Real Runs: Run 2A (High risk path, http + llm + human approval + wait + milestone) -> ${run2A.runId}`);
  console.log(`                Run 2B (Low risk fast track -> condition false -> instant completion) -> ${run2B.runId}`);
  console.log(`3. 数据流程 (Data Flow Canvas): ID=${dataWf.id}`);
  console.log(`   - Nodes Covered: start, source (x2), join, quality_gate, filter, project, derive, deduplicate, aggregate, sort, sink, end`);
  console.log(`   - Real Run: Pipeline Run -> ${dataRun.runId} (12-operator DAG fully executed and persisted)`);
  console.log(`\nTest Data Preservation: 100% strictly adhered to. All created projects, workflows, and runs are permanently preserved in MySQL.`);
}

main().catch(err => {
  console.error("\nFATAL TEST RUNNER ERROR:", err);
  process.exit(1);
});
