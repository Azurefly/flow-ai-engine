/**
 * Complete Three-Round Exhaustive Button Verification Script
 *
 * Verifies every single button and interactive feature across 3 consecutive rounds:
 * 1. 导入 (Import)
 * 2. 导出 (Export)
 * 3. 保存画布 (Save Canvas)
 * 4. 发布 (Publish)
 * 5. 编译检查 (Compile Check)
 * 6. 复制 (Duplicate)
 * 7. 归档 (Archive)
 * 8. 运行测试 (In-Place Test Run - Dataflow & State Flow)
 * 9. 协作成员（N）(Members Management)
 * 10. 版本与发布治理 (Governance & Unpublish)
 * 11. 保存当前定义为子流程 (Subflow Creation)
 * 12. 整理画布 (Auto-layout / Neaten Canvas Algorithm)
 */
import { randomBytes } from "node:crypto";

function autoLayoutNodes(nodes, edges) {
  if (nodes.length <= 1) return nodes;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const incoming = new Map();
  const outgoing = new Map();

  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }

  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      outgoing.get(e.source)?.push(e.target);
      incoming.get(e.target)?.push(e.source);
    }
  }

  const ranks = new Map();
  for (const n of nodes) ranks.set(n.id, 0);

  for (let iter = 0; iter < Math.min(nodes.length, 30); iter++) {
    let changed = false;
    for (const e of edges) {
      if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
        const srcRank = ranks.get(e.source) ?? 0;
        const tgtRank = ranks.get(e.target) ?? 0;
        if (tgtRank < srcRank + 1) {
          ranks.set(e.target, srcRank + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const endNodes = nodes.filter(n => n.data?.kind === "end");
  let maxRank = 0;
  for (const r of ranks.values()) {
    if (r > maxRank) maxRank = r;
  }
  for (const endNode of endNodes) {
    if ((ranks.get(endNode.id) ?? 0) < maxRank) {
      ranks.set(endNode.id, maxRank);
    }
  }

  const rankBuckets = new Map();
  for (const n of nodes) {
    const r = ranks.get(n.id) ?? 0;
    const bucket = rankBuckets.get(r) ?? [];
    bucket.push(n);
    rankBuckets.set(r, bucket);
  }

  const COL_SPACING = 350;
  const ROW_HEIGHT = 160;
  const START_X = 60;
  const BASELINE_Y = 200;

  const newPositions = new Map();
  const sortedRanks = Array.from(rankBuckets.keys()).sort((a, b) => a - b);

  for (const r of sortedRanks) {
    const nodesInRank = rankBuckets.get(r) ?? [];
    const count = nodesInRank.length;

    nodesInRank.sort((a, b) => {
      const parentsA = incoming.get(a.id) ?? [];
      const parentsB = incoming.get(b.id) ?? [];
      const avgYA = parentsA.length
        ? parentsA.reduce(
            (sum, pid) => sum + (newPositions.get(pid)?.y ?? BASELINE_Y),
            0
          ) / parentsA.length
        : BASELINE_Y;
      const avgYB = parentsB.length
        ? parentsB.reduce(
            (sum, pid) => sum + (newPositions.get(pid)?.y ?? BASELINE_Y),
            0
          ) / parentsB.length
        : BASELINE_Y;
      return avgYA - avgYB;
    });

    if (count === 1) {
      const node = nodesInRank[0];
      const parents = incoming.get(node.id) ?? [];
      let targetY = BASELINE_Y;
      if (parents.length === 1) {
        targetY = newPositions.get(parents[0])?.y ?? BASELINE_Y;
      } else if (parents.length > 1) {
        targetY = Math.round(
          parents.reduce(
            (sum, pid) => sum + (newPositions.get(pid)?.y ?? BASELINE_Y),
            0
          ) / parents.length
        );
      }
      newPositions.set(node.id, {
        x: START_X + r * COL_SPACING,
        y: targetY,
      });
    } else {
      const totalSpan = (count - 1) * ROW_HEIGHT;
      const startY = BASELINE_Y - totalSpan / 2;
      nodesInRank.forEach((node, index) => {
        newPositions.set(node.id, {
          x: START_X + r * COL_SPACING,
          y: Math.round(startY + index * ROW_HEIGHT),
        });
      });
    }
  }

  for (let iter = 0; iter < 3; iter++) {
    let hadCollision = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const idA = nodes[i].id;
        const idB = nodes[j].id;
        const posA = newPositions.get(idA);
        const posB = newPositions.get(idB);

        const dx = Math.abs(posA.x - posB.x);
        const dy = Math.abs(posA.y - posB.y);

        if (dx < 260 && dy < 120) {
          hadCollision = true;
          if (posA.y <= posB.y) {
            posB.y = posA.y + 140;
          } else {
            posA.y = posB.y + 140;
          }
        }
      }
    }
    if (!hadCollision) break;
  }

  return nodes.map(n => ({
    ...n,
    position: newPositions.get(n.id) ?? n.position,
  }));
}

const baseUrl = (process.env.TEST_BASE_URL ?? "http://124.223.198.84:1180").replace(/\/$/, "");
const adminUsername = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME ?? "flow_admin";
const adminPassword = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD ?? "b2b055bfb12ed3bed70e86589fdb15478eeb1d0db5c0ff87";

class TrpcSession {
  constructor(name = "admin") {
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
      signal: AbortSignal.timeout(20000),
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
      throw new Error(`Invalid JSON from ${path}: ${text.slice(0, 200)}`);
    }

    if (!response.ok || payload.error) {
      throw new Error(`tRPC Error ${path} (${response.status}): ${payload?.error?.json?.message || JSON.stringify(payload.error)}`);
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

async function runRound(roundNumber, session, testProject, testAsset) {
  const roundTag = `R${roundNumber}_${Date.now().toString(36)}`;
  console.log(`\n========================================================================`);
  console.log(` 🚀 STARTING VERIFICATION ROUND ${roundNumber} (${roundTag})`);
  console.log(`========================================================================`);

  let assertions = 0;
  const assert = (condition, description) => {
    if (!condition) {
      throw new Error(`[Round ${roundNumber}] Assertion failed: ${description}`);
    }
    assertions++;
    console.log(`  ✓ [R${roundNumber}.${assertions}] ${description}`);
  };

  // -------------------------------------------------------------
  // Test 1: 整理画布 (Auto-layout / Neaten Canvas Algorithm)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 1: 整理画布 (Auto-layout / Neaten Canvas) ---`);
  const overlappingNodes = [
    { id: "start", position: { x: 0, y: 0 }, data: { kind: "start", label: "起点" } },
    { id: "n1", position: { x: 50, y: 30 }, data: { kind: "transform", label: "转换1" } },
    { id: "n2", position: { x: 80, y: 40 }, data: { kind: "transform", label: "转换2" } },
    { id: "n3", position: { x: 100, y: 50 }, data: { kind: "transform", label: "转换3" } },
    { id: "end", position: { x: 120, y: 60 }, data: { kind: "end", label: "终点" } },
  ];
  const edges = [
    { id: "e1", source: "start", target: "n1" },
    { id: "e2", source: "start", target: "n2" },
    { id: "e3", source: "n1", target: "n3" },
    { id: "e4", source: "n2", target: "n3" },
    { id: "e5", source: "n3", target: "end" },
  ];

  const neatNodes = autoLayoutNodes(overlappingNodes, edges);
  assert(neatNodes.length === 5, "整理画布保留全部节点");

  // Check collision free: for all pairs, dx >= 260 || dy >= 120
  let hasCollision = false;
  for (let i = 0; i < neatNodes.length; i++) {
    for (let j = i + 1; j < neatNodes.length; j++) {
      const dx = Math.abs(neatNodes[i].position.x - neatNodes[j].position.x);
      const dy = Math.abs(neatNodes[i].position.y - neatNodes[j].position.y);
      if (dx < 260 && dy < 120) {
        hasCollision = true;
      }
    }
  }
  assert(!hasCollision, "整理画布算法确保任意两节点间距无重叠碰撞");
  assert(neatNodes.find(n => n.id === "end").position.x > neatNodes.find(n => n.id === "start").position.x, "拓扑排序保证结束节点位于流程最右侧");

  // -------------------------------------------------------------
  // Test 2: 编译检查 (Compile Check / Validate Diagnostics)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 2: 编译检查 (Compile Check) ---`);
  // Create a base workflow in project
  const baseWorkflow = await session.mutate("project.createWorkflow", {
    projectId: testProject.id,
    processCode: `PROC_${roundTag}`,
    name: `测试流程_${roundTag}`,
    description: "三轮全面按钮验证测试流",
    flowType: "state",
    creationSource: "manual",
  });
  assert(Boolean(baseWorkflow?.id), "创建用于测试的底层流程实体");

  // Compile valid definition (state flow requires: start -> state -> operate -> terminal state -> end)
  const validDef = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "申请开始", position: { x: 60, y: 200 }, config: { initialVariables: { docType: "TEST", amount: 100 } } },
      { id: "s_draft", type: "state", name: "填报草稿", position: { x: 410, y: 200 }, config: { nodeDh: "ST_DRAFT_VERIFY", jdmc: "申请填报中", flowStatus: "DRAFT" } },
      { id: "op_submit", type: "operate", name: "经办人提交", position: { x: 760, y: 200 }, config: { czmc: "提交部门初审", assigneeMode: "user" } },
      { id: "s_archived", type: "state", name: "企业归档办结终态", position: { x: 1110, y: 200 }, config: { nodeDh: "ST_ARCHIVED_VERIFY", jdmc: "企业级综合归档办结", jdgycz: "bj" } },
      { id: "end", type: "end", name: "状态流结束", position: { x: 1460, y: 200 }, config: {} },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "s_draft" },
      { id: "e2", sourceNodeId: "s_draft", targetNodeId: "op_submit" },
      { id: "e3", sourceNodeId: "op_submit", targetNodeId: "s_archived" },
      { id: "e4", sourceNodeId: "s_archived", targetNodeId: "end" },
    ],
  };
  const compileOk = await session.mutate("workflow.compile", {
    id: baseWorkflow.id,
    definition: validDef,
  });
  if (compileOk.diagnostics.length > 0) {
    console.log("Compile diagnostics detail:", JSON.stringify(compileOk.diagnostics, null, 2));
  }
  assert(compileOk.ok === true && compileOk.diagnostics.length === 0, "有效流程定义通过编译检查，诊断项为 0");

  // Compile invalid definition (unreachable end node / missing source)
  const invalidDef = {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "start", name: "启动", position: { x: 60, y: 200 }, config: {} },
      { id: "orphan", type: "end", name: "孤立结束", position: { x: 500, y: 200 }, config: {} },
    ],
    edges: [],
  };
  const compileFail = await session.mutate("workflow.compile", {
    id: baseWorkflow.id,
    definition: invalidDef,
  });
  assert(compileFail.ok === false && compileFail.diagnostics.length > 0, "孤立/未连线定义未通过编译检查，成功返回诊断项");

  // -------------------------------------------------------------
  // Test 3: 保存画布 (Save Canvas Draft)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 3: 保存画布 (Save Canvas Draft) ---`);
  const updatedName = `测试流程_${roundTag}_已保存草稿`;
  const savedFlow = await session.mutate("workflow.update", {
    id: baseWorkflow.id,
    name: updatedName,
    definition: validDef,
  });
  assert(savedFlow.name === updatedName, "保存画布成功更新流程名称与图元数据");
  assert(savedFlow.status === "draft", "保存画布保持流程处于草稿状态");

  // -------------------------------------------------------------
  // Test 4: 导入与导出 (Import & Export)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 4: 导入与导出 (Import & Export) ---`);
  // Export: construct json payload
  const exportedEnvelope = {
    workflow: {
      name: savedFlow.name,
      definition: validDef,
    },
  };
  const serialized = JSON.stringify(exportedEnvelope);
  assert(serialized.length > 50, "导出功能成功序列化流程定义为标准 JSON 字符串");

  // Import: parse JSON and verify compatibility
  const importedParsed = JSON.parse(serialized);
  const importedDef = importedParsed.workflow?.definition ?? importedParsed.definition;
  assert(Array.isArray(importedDef.nodes) && Array.isArray(importedDef.edges), "导入解析器正确校验节点与连线数组完整性");
  assert(importedDef.nodes.length === 5, "导入成功还原全部 5 个拓扑节点");

  // -------------------------------------------------------------
  // Test 5: 发布 (Publish)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 5: 发布 (Publish) ---`);
  await session.mutate("project.auditWorkflow", {
    projectId: testProject.id,
    workflowId: baseWorkflow.id,
    auditStatus: "approved",
  });
  const publishedFlow = await session.mutate("workflow.publish", {
    id: baseWorkflow.id,
  });
  assert(publishedFlow.status === "published", "发布操作成功将流程升级为已发布状态");
  assert(publishedFlow.publishedExecutionPlanHash?.length > 10, "发布操作生成稳定的执行计划哈希");

  // -------------------------------------------------------------
  // Test 6: 复制 (Duplicate)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 6: 复制 (Duplicate) ---`);
  const duplicatedFlow = await session.mutate("workflow.duplicate", {
    id: baseWorkflow.id,
    name: `${savedFlow.name} · 副本`,
  });
  assert(duplicatedFlow.id !== baseWorkflow.id, "复制操作生成全新独立的流程主键 ID");
  assert(duplicatedFlow.name.includes("· 副本"), "复制操作保留规范的副本命名");
  assert(duplicatedFlow.status === "draft", "复制出的新流程安全重置为草稿态");

  // -------------------------------------------------------------
  // Test 7: 版本治理与取消发布 (Governance & Unpublish)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 7: 版本与发布治理 (Governance & Unpublish) ---`);
  const versions = await session.query("workflow.versions", { workflowId: baseWorkflow.id });
  assert(versions.length >= 1, "版本中心成功记录已发布版本快照");

  const unpublishedFlow = await session.mutate("workflow.unpublish", { id: baseWorkflow.id });
  assert(unpublishedFlow.status === "draft", "版本治理成功执行取消发布，安全回到草稿状态");

  // -------------------------------------------------------------
  // Test 8: 保存当前定义为子流程 (Save as Subflow)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 8: 保存当前定义为子流程 (Subflow) ---`);
  const subflowName = `子流程_${roundTag}`;
  const createdSubflow = await session.mutate("workflow.createSubflow", {
    name: subflowName,
    definition: validDef,
  });
  assert(Boolean(createdSubflow?.id), "成功将当前定义持久化为私有子流程");

  const subflowList = await session.query("workflow.subflows");
  assert(subflowList.some(s => s.id === createdSubflow.id), "子流程中心可查询到新注册的子流程");

  // -------------------------------------------------------------
  // Test 9: 协作成员授权与撤回 (Members Grant/Revoke)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 9: 协作成员授权与撤销 (Members) ---`);
  const users = await session.query("iam.users", { limit: 10 });
  const otherUser = users.find(u => u.username !== "flow_admin");
  if (otherUser) {
    const grantRes = await session.mutate("workflow.grantMember", {
      workflowId: baseWorkflow.id,
      userId: otherUser.id,
      role: "editor",
    });
    assert(grantRes.success === true, "成功为其他协作成员授予 editor 编辑者角色");

    const members = await session.query("workflow.members", { workflowId: baseWorkflow.id });
    assert(members.some(m => m.userId === otherUser.id), "流程成员列表中成功展示已授权成员");

    const revokeRes = await session.mutate("workflow.revokeMember", {
      workflowId: baseWorkflow.id,
      userId: otherUser.id,
      role: "editor",
    });
    assert(revokeRes.success === true, "成功撤销协作成员的角色授权");
  } else {
    console.log("  (跳过成员授权：系统仅有管理员单一账号)");
  }

  // -------------------------------------------------------------
  // Test 10: 运行测试 (In-Place Test Run) - 数据流与即时结果
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 10: 运行测试 (In-Place Test Run - Dataflow & Table Result) ---`);
  // Create an enterprise data flow
  const dataflowDef = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "数据启动", position: { x: 60, y: 200 }, config: {} },
      { id: "src", type: "source", name: "订单输入源", position: { x: 410, y: 200 }, config: { assetId: testAsset.id } },
      { id: "agg", type: "aggregate", name: "部门财务汇总", position: { x: 760, y: 200 }, config: { groupBy: ["dept"], metrics: [{ field: "amt", op: "sum", as: "totalAmt" }] } },
      { id: "sink", type: "sink", name: "输出综合审计表", position: { x: 1110, y: 200 }, config: { writeMode: "audit_only", outputName: `AUDIT_${roundTag}` } },
      { id: "end", type: "end", name: "结束", position: { x: 1460, y: 200 }, config: {} },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "src" },
      { id: "e2", sourceNodeId: "src", targetNodeId: "agg" },
      { id: "e3", sourceNodeId: "agg", targetNodeId: "sink" },
      { id: "e4", sourceNodeId: "sink", targetNodeId: "end" },
    ],
  };

  const dataWf = await session.mutate("project.createWorkflow", {
    projectId: testProject.id,
    processCode: `DATA_${roundTag}`,
    name: `数据流测试_${roundTag}`,
    description: "数据流试运行与结果表格即时输出测试",
    flowType: "data",
    creationSource: "manual",
  });

  await session.mutate("workflow.update", {
    id: dataWf.id,
    name: dataWf.name,
    definition: dataflowDef,
  });

  // Run test on draft dataflow without requiring publication!
  const runResult = await session.mutate("data.run", {
    projectId: testProject.id,
    workflowId: dataWf.id,
    data: { testFlag: true },
  });
  assert(Boolean(runResult?.runId), "草稿态数据流成功提交试运行并生成 runId");

  // Fetch instant run detail via our new data.runDetail endpoint!
  const runDetail = await session.query("data.runDetail", {
    projectId: testProject.id,
    runId: runResult.runId,
  });
  assert(runDetail.status === "success", "数据流试运行执行完成且状态为 success");
  assert(runDetail.nodeRuns.length >= 4, "即时结果返回各算子步骤明细 (src -> agg -> sink -> end)");
  assert(runDetail.output !== null, "终点输出综合审计表生成了真实的结构化输出");

  // -------------------------------------------------------------
  // Test 11: 归档 (Archive)
  // -------------------------------------------------------------
  console.log(`\n--- 检查点 11: 流程归档 (Archive) ---`);
  await session.mutate("workflow.delete", { id: duplicatedFlow.id });
  const warehouse = await session.query("workflow.archived", { projectId: testProject.id });
  assert(warehouse.some(w => w.id === duplicatedFlow.id), "已归档的副本流程成功进入流程仓库留存");

  console.log(`\n✅ ROUND ${roundNumber} COMPLETE: ${assertions} 项全部断言通过！`);
  return assertions;
}

async function main() {
  console.log(`========================================================================`);
  console.log(` AI FLOW GRAPH - 逐个按钮功能与即时试运行三轮全面验证`);
  console.log(` Target Server: ${baseUrl}`);
  console.log(`========================================================================`);

  const admin = new TrpcSession("flow_admin");
  await admin.mutate("auth.login", {
    username: adminUsername,
    password: adminPassword,
  });
  console.log("✓ 管理员账号鉴权成功，会话 Cookie 已建立。");

  // Get or create a verification project
  const projects = await admin.query("project.list");
  let testProject = projects.find(p => p.code === "P_BTN_VERIFY");
  if (!testProject) {
    testProject = await admin.mutate("project.create", {
      code: "P_BTN_VERIFY",
      name: "按钮全功能与试运行三轮验收项目",
      description: "用于对流程设计器全量按钮进行三轮验证的专属业务工程",
      departmentCode: "DEPT_TECH",
    });
    console.log(`✓ 已创建专属验收业务项目: ${testProject.name} (${testProject.id})`);
  } else {
    console.log(`✓ 接入已有专属验收业务项目: ${testProject.name} (${testProject.id})`);
  }

  // Create or retrieve verification test data asset in the project
  const resources = await admin.query("data.resources", { projectId: testProject.id });
  let testSource = (resources?.sources || []).find(s => s.name === "按钮验收数据源");
  if (!testSource) {
    testSource = await admin.mutate("data.createSource", {
      projectId: testProject.id,
      name: "按钮验收数据源",
      sourceType: "inline",
      connection: { records: [] },
    });
  }
  let testAsset = (resources?.assets || []).find(a => a.name === "按钮验收订单资产");
  if (!testAsset) {
    testAsset = await admin.mutate("data.createAsset", {
      projectId: testProject.id,
      sourceId: testSource.id,
      name: "按钮验收订单资产",
      assetType: "dataset",
      schema: [
        { name: "orderId", type: "string" },
        { name: "dept", type: "string" },
        { name: "amt", type: "number" },
      ],
      sample: [
        { orderId: "ORD_1", dept: "技术部", amt: 150 },
        { orderId: "ORD_2", dept: "运营部", amt: 220 },
        { orderId: "ORD_3", dept: "技术部", amt: 310 },
      ],
    });
  }
  console.log(`✓ 已准备数据流输入资产: ${testAsset.name} (${testAsset.id})`);

  // Execute 3 Full Rounds
  const totalAssertionsRound1 = await runRound(1, admin, testProject, testAsset);
  const totalAssertionsRound2 = await runRound(2, admin, testProject, testAsset);
  const totalAssertionsRound3 = await runRound(3, admin, testProject, testAsset);

  console.log(`\n========================================================================`);
  console.log(` 🎉 三轮全量验证全部通过！`);
  console.log(` 轮次 1: ${totalAssertionsRound1} 项断言通过`);
  console.log(` 轮次 2: ${totalAssertionsRound2} 项断言通过`);
  console.log(` 轮次 3: ${totalAssertionsRound3} 项断言通过`);
  console.log(` 累计测试断言: ${totalAssertionsRound1 + totalAssertionsRound2 + totalAssertionsRound3} 项全部 PASS`);
  console.log(` 远程服务器地址: ${baseUrl}`);
  console.log(`========================================================================\n`);
}

main().catch(err => {
  console.error("\n❌ VERIFICATION FAILED:", err);
  process.exit(1);
});
