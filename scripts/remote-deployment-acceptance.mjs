/**
 * Run through the deployed app container so credentials stay in its environment.
 * The script prints only non-secret acceptance IDs and outcomes.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const baseUrl = (
  process.env.ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");

class TrpcRequestError extends Error {
  constructor(path, status, payload) {
    super(payload?.error?.json?.message ?? `tRPC request failed: ${path}`);
    this.name = "TrpcRequestError";
    this.path = path;
    this.status = status;
    this.code = payload?.error?.json?.data?.code ?? "UNKNOWN";
  }
}

class TrpcSession {
  cookie = "";

  async request(path, method, input = null) {
    const envelope = JSON.stringify({ json: input });
    const url =
      method === "GET"
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
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    if (setCookies.length) this.cookie = setCookies[0].split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error)
      throw new TrpcRequestError(path, response.status, payload);
    return payload.result?.data?.json;
  }

  query(path, input = null) {
    return this.request(path, "GET", input);
  }

  mutate(path, input = null) {
    return this.request(path, "POST", input);
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function waitForWorkflowRun(session, runId) {
  const terminalStatuses = new Set([
    "success",
    "failed",
    "cancelled",
    "terminated",
  ]);
  const deadline = Date.now() + 90_000;
  let detail = null;
  while (Date.now() < deadline) {
    detail = await session.query("workflow.runDetail", { runId });
    if (!detail || terminalStatuses.has(detail.status)) return detail;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `workflow run did not reach a terminal state (last: ${detail?.status ?? "missing"})`
  );
}

async function loginAdmin() {
  const session = new TrpcSession();
  const username = requiredEnv("FLOW_BOOTSTRAP_ADMIN_USERNAME");
  const user = await session.mutate("auth.login", {
    username,
    password: requiredEnv("FLOW_BOOTSTRAP_ADMIN_PASSWORD"),
  });
  assert(
    user?.username === username.toLowerCase(),
    "bootstrap admin login returned the wrong user"
  );
  const current = await session.query("auth.me");
  assert(
    current?.id === user.id && current?.role === "admin",
    "authenticated admin session was not retained"
  );
  return { session, user };
}

function executableDefinition() {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      {
        id: "start",
        type: "start",
        name: "开始",
        position: { x: 0, y: 0 },
        config: { initialVariables: { source: "{{input.source}}" } },
      },
      {
        id: "state",
        type: "state",
        name: "已接收",
        position: { x: 220, y: 0 },
        config: { stateCode: "RECEIVED", displayName: "已接收" },
      },
      {
        id: "end",
        type: "end",
        name: "结束",
        position: { x: 440, y: 0 },
        config: {
          resultTemplate: {
            state: "{{nodes.state.stateCode}}",
            source: "{{vars.source}}",
          },
        },
      },
    ],
    edges: [
      { id: "start-state", sourceNodeId: "start", targetNodeId: "state" },
      { id: "state-end", sourceNodeId: "state", targetNodeId: "end" },
    ],
  };
}

async function verifyDeploymentRoutes() {
  const { session: admin } = await loginAdmin();
  const readinessResponse = await fetch(`${baseUrl}/readyz`);
  const readiness = await readinessResponse.json();
  assert(
    readinessResponse.ok && readiness.ready,
    "deployed application is not ready"
  );
  const expectedMigration = process.env.EXPECTED_MIGRATION_VERSION;
  if (expectedMigration) {
    const runtime = await admin.query("config.runtimeInfo");
    assert(
      runtime?.migrationVersion === expectedMigration,
      "deployed migration version did not match the requested acceptance version"
    );
  }

  const username = requiredEnv("FLOW_BOOTSTRAP_ADMIN_USERNAME").toLowerCase();
  const users = await admin.query("project.searchActiveUsers", {
    query: username,
  });
  const adminMatch = users?.items?.find(
    candidate => candidate.username === username
  );
  assert(
    adminMatch?.id,
    "authorized user directory search missed the admin account"
  );
  assert(
    !Object.hasOwn(adminMatch, "email"),
    "user directory search exposed an email field"
  );
  assert(typeof users.hasMore === "boolean", "user search omitted hasMore");

  const units = await admin.query("project.activeUnits");
  assert(
    Array.isArray(units),
    "active department lookup did not return a list"
  );
  if (units.length) {
    assert(
      typeof units[0].displayPath === "string",
      "active department did not include its application-computed path"
    );
  }
  const unitSearch = await admin.query("project.searchActiveUnits", {
    query: units[0]?.code ?? "REMOTE_ACCEPTANCE_NO_MATCH",
  });
  assert(
    Array.isArray(unitSearch?.items),
    "department search did not return items"
  );
  assert(
    typeof unitSearch.hasMore === "boolean",
    "department search omitted hasMore"
  );
  if (units.length) {
    assert(
      unitSearch.items.some(unit => unit.id === units[0].id),
      "department search missed an existing department by code"
    );
  }

  return {
    ready: readiness.ready,
    migrationVersion: readiness.runtime?.migrationVersion,
    userDirectorySearch: true,
    userSearchEmailFieldOmitted: true,
    activeDepartmentCount: units.length,
    departmentPathComputed:
      !units.length || typeof units[0].displayPath === "string",
    departmentSearch: true,
  };
}

async function createAcceptance() {
  const acceptanceId = (
    process.env.ACCEPTANCE_ID ??
    new Date().toISOString().replace(/\D/g, "").slice(0, 14)
  ).toUpperCase();
  const acceptanceAttempt = process.env.ACCEPTANCE_ATTEMPT ?? "1";
  const prefix = `REMOTE_ACCEPTANCE_${acceptanceId}`;
  const { session: admin, user: adminUser } = await loginAdmin();

  const anonymous = new TrpcSession();
  let unauthenticatedCode = null;
  try {
    await anonymous.query("project.list");
  } catch (error) {
    if (!(error instanceof TrpcRequestError)) throw error;
    unauthenticatedCode = error.code;
  }
  assert(
    unauthenticatedCode === "UNAUTHORIZED",
    "protected project route did not reject an anonymous request"
  );

  const viewerUsername = `${prefix}_VIEWER_${acceptanceAttempt}`.toLowerCase();
  const viewerPassword = randomBytes(24).toString("hex");
  const createdViewer = await admin.mutate("iam.createUser", {
    username: viewerUsername,
    password: viewerPassword,
    name: `${prefix} Viewer`,
    role: "user",
  });
  const viewer = { id: createdViewer?.userId, username: viewerUsername };
  assert(viewer.id, "acceptance viewer was not created");

  const globalUserSearch = await admin.query("project.searchActiveUsers", {
    query: viewerUsername,
  });
  const globalUserMatch = globalUserSearch?.items?.find(
    candidate => candidate.username === viewerUsername
  );
  assert(
    globalUserMatch?.id,
    "authorized global user search missed the new account"
  );
  assert(
    !Object.hasOwn(globalUserMatch, "email"),
    "user search exposed an email field"
  );
  assert(
    typeof globalUserSearch.hasMore === "boolean",
    "user search omitted hasMore"
  );

  const units = await admin.query("project.activeUnits");
  assert(
    Array.isArray(units),
    "active department lookup did not return a list"
  );
  if (units.length) {
    assert(
      typeof units[0].displayPath === "string",
      "active department did not include its application-computed path"
    );
  }
  const unitSearch = await admin.query("project.searchActiveUnits", {
    query: units[0]?.code ?? "REMOTE_ACCEPTANCE_NO_MATCH",
  });
  assert(
    Array.isArray(unitSearch?.items),
    "department search did not return items"
  );
  assert(
    typeof unitSearch.hasMore === "boolean",
    "department search omitted hasMore"
  );
  if (units.length) {
    assert(
      unitSearch.items.some(unit => unit.id === units[0].id),
      "department search missed an existing department by code"
    );
  }

  const projectCode = `RA_${acceptanceId}`;
  const existingProjects = await admin.query("project.list");
  const project =
    existingProjects.find(candidate => candidate.code === projectCode) ??
    (await admin.mutate("project.create", {
      code: projectCode,
      name: prefix,
      description: "Remote deployment acceptance project",
    }));
  assert(project?.id, "acceptance project was not created");

  const scopedUserSearch = await admin.query("project.searchActiveUsers", {
    query: viewerUsername,
    projectId: project.id,
  });
  assert(
    scopedUserSearch?.items?.some(
      candidate => candidate.username === viewerUsername
    ),
    "project-scoped user search missed the new account"
  );

  const publishedStateWorkflows = await admin.query("project.workflows", {
    projectId: project.id,
    flowType: "state",
    status: "published",
    keyword: prefix,
  });
  let workflow = publishedStateWorkflows.find(candidate =>
    candidate.name.startsWith(prefix)
  );
  if (!workflow) {
    workflow = await admin.mutate("project.createWorkflow", {
      projectId: project.id,
      processCode: `RA_${acceptanceId}_FLOW_${acceptanceAttempt}`,
      name: `${prefix}_STATE_FLOW_${acceptanceAttempt}`,
      description: "Remote deployment acceptance state workflow",
      flowType: "state",
      creationSource: "manual",
      definition: executableDefinition(),
    });
  }
  assert(workflow?.id, "acceptance workflow was not created");
  if (workflow.status !== "published") {
    await admin.mutate("project.auditWorkflow", {
      projectId: project.id,
      workflowId: workflow.id,
      auditStatus: "approved",
    });
    const published = await admin.mutate("workflow.publish", {
      id: workflow.id,
    });
    assert(
      published?.status === "published",
      "acceptance workflow was not published"
    );
  }

  const existingRuns = await admin.query("workflow.runs", {
    workflowId: workflow.id,
    limit: 50,
  });
  let successfulRun = existingRuns.find(candidate => {
    const output = parseJsonValue(candidate.finalOutputJson);
    return (
      candidate.status === "success" &&
      output?.result?.source === "remote-deployment"
    );
  });
  if (!successfulRun) {
    const submittedRun = await admin.mutate("workflow.run", {
      workflowId: workflow.id,
      input: { source: "remote-deployment" },
    });
    assert(submittedRun?.runId, "workflow run was not accepted");
    const completedRun = await waitForWorkflowRun(admin, submittedRun.runId);
    successfulRun = {
      id: submittedRun.runId,
      status: completedRun?.status,
      finalOutputJson: completedRun?.finalOutputJson,
    };
  }
  const run = {
    runId: successfulRun.id,
    status: successfulRun.status,
    output: parseJsonValue(successfulRun.finalOutputJson),
  };
  assert(
    run?.runId && run.status === "success",
    "acceptance workflow did not complete successfully"
  );
  assert(
    run.output?.result?.state === "RECEIVED",
    "acceptance workflow returned the wrong state"
  );
  assert(
    run.output?.result?.source === "remote-deployment",
    "acceptance workflow returned the wrong input value"
  );
  const detail = await admin.query("workflow.runDetail", { runId: run.runId });
  assert(detail?.id === run.runId, "run detail did not return the created run");
  assert(
    detail.workflowName === workflow.name &&
      detail.currentStateName === "已接收" &&
      detail.currentStateCode === "RECEIVED",
    "run detail lost its workflow identity or recorded business state name"
  );
  assert(
    Array.isArray(detail.nodeRuns) && detail.nodeRuns.length === 3,
    "run detail did not retain all node logs"
  );
  assert(
    detail.nodeRuns.every(nodeRun => nodeRun.status === "success"),
    "a node log did not finish successfully"
  );
  const workbenchPage = await admin.query("task.instancePage", {
    view: "initiated",
    search: workflow.name,
    limit: 100,
  });
  const workbenchRun = workbenchPage.items.find(item => item.id === run.runId);
  assert(
    workbenchRun?.stateName === "已接收" &&
      workbenchRun?.stateCode === "RECEIVED",
    "workbench business state name was masked by a legacy default"
  );

  let paginationRun = existingRuns.find(candidate => {
    const output = parseJsonValue(candidate.finalOutputJson);
    return (
      candidate.status === "success" &&
      output?.result?.source === "remote-pagination"
    );
  });
  if (!paginationRun) {
    const submittedPaginationRun = await admin.mutate("workflow.run", {
      workflowId: workflow.id,
      input: { source: "remote-pagination" },
    });
    assert(
      submittedPaginationRun?.runId,
      "pagination probe run was not accepted"
    );
    const completedPaginationRun = await waitForWorkflowRun(
      admin,
      submittedPaginationRun.runId
    );
    paginationRun = {
      id: submittedPaginationRun.runId,
      status: completedPaginationRun?.status,
      finalOutputJson: completedPaginationRun?.finalOutputJson,
    };
  }
  assert(
    paginationRun?.status === "success" &&
      parseJsonValue(paginationRun.finalOutputJson)?.result?.source ===
        "remote-pagination",
    "pagination probe run did not complete successfully"
  );

  const newestRunPage = await admin.query("workflow.runHistoryPage", {
    workflowId: workflow.id,
    pageSize: 1,
  });
  assert(
    newestRunPage?.items?.length === 1 &&
      newestRunPage.hasMore === true &&
      typeof newestRunPage.nextCursor === "string",
    "run history did not return the first bounded page and continuation cursor"
  );
  assert(
    !Object.hasOwn(newestRunPage.items[0], "inputJson") &&
      !Object.hasOwn(newestRunPage.items[0], "finalOutputJson") &&
      !Object.hasOwn(newestRunPage.items[0], "errorJson"),
    "run history page exposed full execution payloads in the summary list"
  );
  const olderRunPage = await admin.query("workflow.runHistoryPage", {
    workflowId: workflow.id,
    pageSize: 1,
    cursor: newestRunPage.nextCursor,
  });
  assert(
    olderRunPage?.items?.length === 1 &&
      olderRunPage.items[0].id !== newestRunPage.items[0].id,
    "run history cursor did not advance to a distinct older record"
  );
  const successfulRunSearch = await admin.query("workflow.runHistoryPage", {
    workflowId: workflow.id,
    pageSize: 50,
    searchQuery: "success",
  });
  assert(
    successfulRunSearch?.items?.length >= 2 &&
      successfulRunSearch.items.every(run => run.status === "success"),
    "run history did not search matching records across the workflow history"
  );
  const emptyRunSearch = await admin.query("workflow.runHistoryPage", {
    workflowId: workflow.id,
    pageSize: 50,
    searchQuery: "REMOTE_ACCEPTANCE_NO_SUCH_RUN_20260926",
  });
  assert(
    emptyRunSearch?.items?.length === 0 && emptyRunSearch.hasMore === false,
    "run history did not return a stable no-match state"
  );

  let viewerDirectorySearchDeniedCode = null;
  let viewerRunDenied = false;
  let viewerRunDeniedCode = null;
  let viewerProjectGrantRevoked = false;
  let viewerAccountDisabled = false;
  let viewerGrantApplied = false;
  try {
    const grant = await admin.mutate("project.grantMember", {
      projectId: project.id,
      userId: Number(viewer.id),
      role: "viewer",
    });
    assert(grant?.success, "acceptance viewer project grant failed");
    viewerGrantApplied = true;

    const viewerSession = new TrpcSession();
    await viewerSession.mutate("auth.login", {
      username: viewerUsername,
      password: viewerPassword,
    });
    const viewerWorkflow = await viewerSession.query("workflow.get", {
      id: workflow.id,
    });
    assert(
      viewerWorkflow?.id === workflow.id,
      "viewer could not read the granted workflow"
    );
    try {
      await viewerSession.query("project.searchActiveUsers", {
        query: viewerUsername,
        projectId: project.id,
      });
    } catch (error) {
      if (!(error instanceof TrpcRequestError)) throw error;
      viewerDirectorySearchDeniedCode = error.code;
    }
    assert(
      viewerDirectorySearchDeniedCode === "FORBIDDEN",
      "viewer unexpectedly received project-scoped user directory access"
    );
    try {
      await viewerSession.mutate("workflow.run", {
        workflowId: workflow.id,
        input: {},
      });
    } catch (error) {
      if (!(error instanceof TrpcRequestError)) throw error;
      viewerRunDenied = true;
      viewerRunDeniedCode = error.code;
    }
    assert(
      viewerRunDenied,
      "viewer unexpectedly received workflow execution permission"
    );
    assert(
      viewerRunDeniedCode === "FORBIDDEN",
      "viewer denial did not return the FORBIDDEN tRPC code"
    );
  } finally {
    try {
      if (viewerGrantApplied) {
        const revoked = await admin.mutate("project.revokeMember", {
          projectId: project.id,
          userId: Number(viewer.id),
        });
        viewerProjectGrantRevoked = revoked?.success === true;
      }
    } finally {
      const disabled = await admin.mutate("iam.updateUserStatus", {
        userId: Number(viewer.id),
        status: "disabled",
      });
      viewerAccountDisabled = disabled?.success === true;
    }
  }
  assert(viewerProjectGrantRevoked, "acceptance viewer grant was not revoked");
  assert(viewerAccountDisabled, "acceptance viewer account was not disabled");
  const activeMembers = await admin.query("project.members", {
    projectId: project.id,
  });
  const viewerProjectMembershipHidden = !activeMembers.some(
    member => Number(member.userId) === Number(viewer.id)
  );
  assert(
    viewerProjectMembershipHidden,
    "project members still displayed a revoked or disabled viewer as active"
  );

  return {
    acceptanceId,
    acceptanceAttempt,
    prefix,
    createdAt: new Date().toISOString(),
    adminUserId: Number(adminUser.id),
    viewerUserId: Number(viewer.id),
    projectId: project.id,
    workflowId: workflow.id,
    runId: run.runId,
    paginationRunId: paginationRun.id,
    runStatus: run.status,
    runOutput: run.output,
    nodeRunCount: detail.nodeRuns.length,
    workbenchBusinessStateName: workbenchRun.stateName,
    runHistoryPageSize: newestRunPage.pageSize,
    runHistoryHasMore: newestRunPage.hasMore,
    runHistoryDistinctOlderRecord:
      olderRunPage.items[0].id !== newestRunPage.items[0].id,
    runHistorySummaryPayloadOmitted: true,
    runHistoryServerSearchCount: successfulRunSearch.items.length,
    runHistoryNoMatch: emptyRunSearch.items.length === 0,
    unauthenticatedCode,
    globalUserDirectorySearch: true,
    userSearchEmailFieldOmitted: true,
    departmentSearch: true,
    projectScopedUserSearch: true,
    viewerDirectorySearchDeniedCode,
    viewerRunDenied,
    viewerRunDeniedCode,
    viewerProjectGrantRevoked,
    viewerAccountDisabled,
    viewerProjectMembershipHidden,
  };
}

async function verifyPersistence(statePath) {
  assert(statePath, "state path is required for verify mode");
  const stateText =
    statePath === "-"
      ? await readStandardInput()
      : await readFile(statePath, "utf8");
  const state = JSON.parse(stateText);
  const { session: admin, user: adminUser } = await loginAdmin();
  const projects = await admin.query("project.list");
  assert(
    projects.some(project => project.id === state.projectId),
    "acceptance project did not survive restart"
  );
  const workflow = await admin.query("workflow.get", { id: state.workflowId });
  assert(
    workflow?.id === state.workflowId && workflow.status === "published",
    "published workflow did not survive restart"
  );
  const runs = await admin.query("workflow.runs", {
    workflowId: state.workflowId,
    limit: 20,
  });
  assert(
    runs.some(run => run.id === state.runId && run.status === "success"),
    "successful run did not survive restart"
  );
  assert(
    runs.some(
      run => run.id === state.paginationRunId && run.status === "success"
    ),
    "pagination probe run did not survive restart"
  );
  const firstRunPage = await admin.query("workflow.runHistoryPage", {
    workflowId: state.workflowId,
    pageSize: 1,
  });
  assert(
    firstRunPage?.items?.length === 1 &&
      firstRunPage.hasMore &&
      typeof firstRunPage.nextCursor === "string",
    "run history pagination did not survive restart"
  );
  const olderRunPage = await admin.query("workflow.runHistoryPage", {
    workflowId: state.workflowId,
    pageSize: 1,
    cursor: firstRunPage.nextCursor,
  });
  assert(
    olderRunPage?.items?.length === 1 &&
      olderRunPage.items[0].id !== firstRunPage.items[0].id,
    "run history cursor did not reach a second persisted record"
  );
  const detail = await admin.query("workflow.runDetail", {
    runId: state.runId,
  });
  assert(
    detail?.nodeRuns?.length === state.nodeRunCount,
    "node logs did not survive restart"
  );
  return {
    ...state,
    verifiedAt: new Date().toISOString(),
    persistenceVerified: true,
    verifiedAdminUserId: Number(adminUser.id),
    persistedProject: true,
    persistedPublishedWorkflow: true,
    persistedSuccessfulRun: true,
    persistedRunHistoryPagination: true,
    persistedNodeRunCount: detail.nodeRuns.length,
  };
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const mode = process.argv[2] ?? "create";
const result =
  mode === "preflight"
    ? await verifyDeploymentRoutes()
    : mode === "create"
      ? await createAcceptance()
      : mode === "verify"
        ? await verifyPersistence(process.argv[3])
        : (() => {
            throw new Error(`unsupported mode: ${mode}`);
          })();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
