import { randomUUID } from "node:crypto";
import { createUser } from "../server/internal-auth.ts";
import { createProject, createProjectWorkflow, createFolder, setProjectWorkflowAudit } from "../server/project-service.ts";

const suffix = randomUUID().slice(0, 8);
const username = `p0_ui_${suffix}`;
const password = `P0-ui-${suffix}-Secure!`;
const userId = await createUser({ username, password, name: "P0 界面验收", role: "admin" });
const user = { id: userId, role: "admin" };
const projectId = await createProject(user, { code: `DEMO${suffix.slice(0, 4)}`.toUpperCase(), name: "原始工作区验收项目", description: "仅用于本地浏览器验收" });
const folderId = await createFolder(user, { projectId, name: "已发布流程" });
const workflow = await createProjectWorkflow(user, { projectId, folderId, name: "原始控制流程示例", description: "用于验证三类流程、审批和仓库预览", flowType: "control" });
await setProjectWorkflowAudit(user, { projectId, workflowId: workflow.id, auditStatus: "approved" });
console.log(JSON.stringify({ username, password, userId, projectId, folderId, workflowId: workflow.id }));
