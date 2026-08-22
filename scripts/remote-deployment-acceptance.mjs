/**
 * Run through the deployed app container so credentials stay in its environment.
 * The script prints only non-secret acceptance IDs and outcomes.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const baseUrl = (process.env.ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

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
    const payload = await response.json();
    if (!response.ok || payload.error) throw new TrpcRequestError(path, response.status, payload);
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

async function loginAdmin() {
  const session = new TrpcSession();
  const username = requiredEnv("FLOW_BOOTSTRAP_ADMIN_USERNAME");
  const user = await session.mutate("auth.login", {
    username,
    password: requiredEnv("FLOW_BOOTSTRAP_ADMIN_PASSWORD"),
  });
  assert(user?.username === username.toLowerCase(), "bootstrap admin login returned the wrong user");
  const current = await session.query("auth.me");
  assert(current?.id === user.id && current?.role === "admin", "authenticated admin session was not retained");
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
        config: { resultTemplate: { state: "{{nodes.state.stateCode}}", source: "{{vars.source}}" } },
      },
    ],
    edges: [
      { id: "start-state", sourceNodeId: "start", targetNodeId: "state" },
      { id: "state-end", sourceNodeId: "state", targetNodeId: "end" },
    ],
  };
}

async function createAcceptance() {
  const acceptanceId = (process.env.ACCEPTANCE_ID ?? new Date().toISOString().replace(/\D/g, "").slice(0, 14)).toUpperCase();
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
  assert(unauthenticatedCode === "UNAUTHORIZED", "protected project route did not reject an anonymous request");

  const viewerUsername = `${prefix}_VIEWER`.toLowerCase();
  const viewerPassword = randomBytes(24).toString("hex");
  await admin.mutate("iam.createUser", {
    username: viewerUsername,
    password: viewerPassword,
    name: `${prefix} Viewer`,
    role: "user",
  });
  const users = await admin.query("iam.users");
  const viewer = users.find(candidate => candidate.username === viewerUsername);
  assert(viewer?.id, "acceptance viewer was not created");

  const project = await admin.mutate("project.create", {
    code: `RA_${acceptanceId}`,
    name: prefix,
    description: "Remote deployment acceptance project",
  });
  assert(project?.id, "acceptance project was not created");

  const workflow = await admin.mutate("project.createWorkflow", {
    projectId: project.id,
    processCode: `RA_${acceptanceId}_FLOW`,
    name: `${prefix}_CONTROL_FLOW`,
    description: "Remote deployment acceptance control workflow",
    flowType: "control",
    creationSource: "manual",
    definition: executableDefinition(),
  });
  assert(workflow?.id, "acceptance workflow was not created");
  await admin.mutate("project.auditWorkflow", {
    projectId: project.id,
    workflowId: workflow.id,
    auditStatus: "approved",
  });
  const published = await admin.mutate("workflow.publish", { id: workflow.id });
  assert(published?.status === "published", "acceptance workflow was not published");

  const run = await admin.mutate("workflow.run", {
    workflowId: workflow.id,
    input: { source: "remote-deployment" },
  });
  assert(run?.runId && run.status === "success", "acceptance workflow did not complete successfully");
  assert(run.output?.result?.state === "RECEIVED", "acceptance workflow returned the wrong state");
  assert(run.output?.result?.source === "remote-deployment", "acceptance workflow returned the wrong input value");
  const detail = await admin.query("workflow.runDetail", { runId: run.runId });
  assert(detail?.id === run.runId, "run detail did not return the created run");
  assert(Array.isArray(detail.nodeRuns) && detail.nodeRuns.length === 3, "run detail did not retain all node logs");
  assert(detail.nodeRuns.every(nodeRun => nodeRun.status === "success"), "a node log did not finish successfully");

  await admin.mutate("project.grantMember", {
    projectId: project.id,
    userId: Number(viewer.id),
    role: "viewer",
  });
  const viewerSession = new TrpcSession();
  await viewerSession.mutate("auth.login", { username: viewerUsername, password: viewerPassword });
  const viewerWorkflow = await viewerSession.query("workflow.get", { id: workflow.id });
  assert(viewerWorkflow?.id === workflow.id, "viewer could not read the granted workflow");
  let viewerRunDenied = false;
  let viewerRunDeniedCode = null;
  try {
    await viewerSession.mutate("workflow.run", { workflowId: workflow.id, input: {} });
  } catch (error) {
    if (!(error instanceof TrpcRequestError)) throw error;
    viewerRunDenied = true;
    viewerRunDeniedCode = error.code;
  }
  assert(viewerRunDenied, "viewer unexpectedly received workflow execution permission");
  assert(viewerRunDeniedCode === "FORBIDDEN", "viewer denial did not return the FORBIDDEN tRPC code");

  return {
    acceptanceId,
    prefix,
    createdAt: new Date().toISOString(),
    adminUserId: Number(adminUser.id),
    viewerUserId: Number(viewer.id),
    projectId: project.id,
    workflowId: workflow.id,
    runId: run.runId,
    runStatus: run.status,
    runOutput: run.output,
    nodeRunCount: detail.nodeRuns.length,
    unauthenticatedCode,
    viewerRunDenied,
    viewerRunDeniedCode,
  };
}

async function verifyPersistence(statePath) {
  assert(statePath, "state path is required for verify mode");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const { session: admin, user: adminUser } = await loginAdmin();
  const projects = await admin.query("project.list");
  assert(projects.some(project => project.id === state.projectId), "acceptance project did not survive restart");
  const workflow = await admin.query("workflow.get", { id: state.workflowId });
  assert(workflow?.id === state.workflowId && workflow.status === "published", "published workflow did not survive restart");
  const runs = await admin.query("workflow.runs", { workflowId: state.workflowId, limit: 20 });
  assert(runs.some(run => run.id === state.runId && run.status === "success"), "successful run did not survive restart");
  const detail = await admin.query("workflow.runDetail", { runId: state.runId });
  assert(detail?.nodeRuns?.length === state.nodeRunCount, "node logs did not survive restart");
  return {
    ...state,
    verifiedAt: new Date().toISOString(),
    persistenceVerified: true,
    verifiedAdminUserId: Number(adminUser.id),
    persistedProject: true,
    persistedPublishedWorkflow: true,
    persistedSuccessfulRun: true,
    persistedNodeRunCount: detail.nodeRuns.length,
  };
}

const mode = process.argv[2] ?? "create";
const result = mode === "create"
  ? await createAcceptance()
  : mode === "verify"
    ? await verifyPersistence(process.argv[3])
    : (() => { throw new Error(`unsupported mode: ${mode}`); })();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
