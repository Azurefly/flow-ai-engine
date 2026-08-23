import mysql from "mysql2/promise";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createLeaveApprovalDefinition } from "../shared/leave-approval-workflow";
import { createUser } from "../server/internal-auth";
import {
  assignOrganizationMember,
  createOrganizationUnit,
} from "../server/organization-service";
import {
  createProject,
  createProjectWorkflow,
  grantProjectMember,
  setProjectWorkflowAudit,
} from "../server/project-service";
import { updateWorkflow, type Definition } from "../server/workflow-service";

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.LEAVE_DEMO_PASSWORD;
const rotatePassword = process.env.LEAVE_DEMO_ROTATE_PASSWORD !== "false";
const suffix = (
  process.env.LEAVE_DEMO_SUFFIX ||
  new Date().toISOString().replace(/\D/g, "").slice(0, 12)
).toLowerCase();

if (!databaseUrl) throw new Error("DATABASE_URL 未配置。");
if (!password || password.length < 12)
  throw new Error("LEAVE_DEMO_PASSWORD 必须至少 12 个字符。");
if (!/^[a-z0-9]{6,24}$/.test(suffix))
  throw new Error("LEAVE_DEMO_SUFFIX 只能包含 6 至 24 位小写字母或数字。");

const usernames = {
  admin: `leave_admin_${suffix}`,
  employee: `leave_employee_${suffix}`,
  supervisor: `leave_supervisor_${suffix}`,
  manager: `leave_manager_${suffix}`,
};

const pool = mysql.createPool(databaseUrl);
const scrypt = promisify(scryptCallback);

async function encodePassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = (await scrypt(value, salt, 64)) as Buffer;
  return `${salt}:${digest.toString("hex")}`;
}

async function main() {
  const [existing] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT username FROM users WHERE username IN (?,?,?,?)",
    [
      usernames.admin,
      usernames.employee,
      usernames.supervisor,
      usernames.manager,
    ]
  );
  if (existing.length) {
    if (
      process.env.LEAVE_DEMO_REUSE_EXISTING !== "true" ||
      existing.length !== 4
    ) {
      throw new Error(
        "同名请假演示账号已存在，请更换 LEAVE_DEMO_SUFFIX，避免覆盖既有验收数据。"
      );
    }
    const [projects] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM flow_project WHERE code=? LIMIT 1",
      [`LV${suffix.slice(0, 12).toUpperCase()}`]
    );
    const projectId = projects[0]?.id ? String(projects[0].id) : "";
    const [workflows] = projectId
      ? await pool.query<mysql.RowDataPacket[]>(
          "SELECT id,definitionJson FROM workflow WHERE projectId=? AND processCode=? LIMIT 1",
          [projectId, `LEAVE_${suffix.slice(0, 12).toUpperCase()}`]
        )
      : [[] as mysql.RowDataPacket[], []];
    if (!projectId || !workflows[0]?.id)
      throw new Error(
        "同名账号存在，但请假演示项目或流程不完整，拒绝静默复用。"
      );
    const workflowId = String(workflows[0].id);
    const [adminRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM users WHERE username=? LIMIT 1",
      [usernames.admin]
    );
    const admin = adminRows[0];
    if (!admin) throw new Error("请假演示管理员账号不存在，拒绝更新流程定义。");

    const nextDefinition = createLeaveApprovalDefinition() as Definition;
    const currentDefinition =
      typeof workflows[0].definitionJson === "string"
        ? JSON.parse(workflows[0].definitionJson)
        : workflows[0].definitionJson;
    const definitionUpdated =
      JSON.stringify(currentDefinition) !== JSON.stringify(nextDefinition);
    if (definitionUpdated) {
      const updated = await updateWorkflow(workflowId, admin, {
        definition: nextDefinition,
        publish: true,
      });
      if (!updated) throw new Error("请假演示流程定义更新失败。");
    }

    if (rotatePassword) {
      const passwordHash = await encodePassword(password);
      await pool.query(
        "UPDATE users SET passwordHash=?,status='active' WHERE username IN (?,?,?,?)",
        [
          passwordHash,
          usernames.admin,
          usernames.employee,
          usernames.supervisor,
          usernames.manager,
        ]
      );
      await pool.query(
        "UPDATE auth_session s JOIN users u ON u.id=s.userId SET s.revokedAt=NOW() WHERE u.username IN (?,?,?,?) AND s.revokedAt IS NULL",
        [
          usernames.admin,
          usernames.employee,
          usernames.supervisor,
          usernames.manager,
        ]
      );
    }
    console.log(
      JSON.stringify(
        {
          suffix,
          projectId,
          workflowId,
          usernames,
          reused: true,
          definitionUpdated,
          passwordRotated: rotatePassword,
        },
        null,
        2
      )
    );
    return;
  }

  await createUser({
    username: usernames.admin,
    password,
    name: "请假流程管理员",
    role: "admin",
  });
  await createUser({
    username: usernames.employee,
    password,
    name: "请假员工",
    role: "user",
  });
  await createUser({
    username: usernames.supervisor,
    password,
    name: "直接上级",
    role: "user",
  });
  await createUser({
    username: usernames.manager,
    password,
    name: "部门经理",
    role: "user",
  });

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM users WHERE username IN (?,?,?,?)",
    [
      usernames.admin,
      usernames.employee,
      usernames.supervisor,
      usernames.manager,
    ]
  );
  const byUsername = new Map(rows.map(row => [String(row.username), row]));
  const admin = byUsername.get(usernames.admin)!;
  const employee = byUsername.get(usernames.employee)!;
  const supervisor = byUsername.get(usernames.supervisor)!;
  const manager = byUsername.get(usernames.manager)!;

  const managementUnitId = await createOrganizationUnit(admin, {
    code: `MGT_${suffix.toUpperCase()}`,
    name: "管理部",
    managerUserId: manager.id,
  });
  const teamUnitId = await createOrganizationUnit(admin, {
    code: `TEAM_${suffix.toUpperCase()}`,
    name: "研发组",
    parentUnitId: managementUnitId,
    managerUserId: supervisor.id,
  });
  await assignOrganizationMember(admin, {
    unitId: teamUnitId,
    userId: employee.id,
    title: "员工",
    isPrimary: true,
  });
  await assignOrganizationMember(admin, {
    unitId: teamUnitId,
    userId: supervisor.id,
    title: "直接上级",
    isPrimary: true,
  });
  await assignOrganizationMember(admin, {
    unitId: managementUnitId,
    userId: manager.id,
    title: "经理",
    isPrimary: true,
  });

  const projectId = await createProject(admin, {
    code: `LV${suffix.slice(0, 12).toUpperCase()}`,
    name: "请假流程界面验收",
    description: "员工发起、直接上级审批、自动补充经理并最终通过。",
  });
  await grantProjectMember(admin, {
    projectId,
    userId: employee.id,
    role: "operator",
  });
  await grantProjectMember(admin, {
    projectId,
    userId: supervisor.id,
    role: "operator",
  });
  await grantProjectMember(admin, {
    projectId,
    userId: manager.id,
    role: "operator",
  });
  const workflow = await createProjectWorkflow(admin, {
    projectId,
    processCode: `LEAVE_${suffix.slice(0, 12).toUpperCase()}`,
    name: "员工请假流程",
    description: "参考安装包节点配置：自动补直属上级，审核后自动补经理。",
    flowType: "state",
    definition: createLeaveApprovalDefinition() as Definition,
  });
  await setProjectWorkflowAudit(admin, {
    projectId,
    workflowId: workflow.id,
    auditStatus: "approved",
  });
  await updateWorkflow(workflow.id, admin, { publish: true });

  console.log(
    JSON.stringify(
      { suffix, projectId, workflowId: workflow.id, usernames },
      null,
      2
    )
  );
}

try {
  await main();
  await pool.end();
  process.exit(0);
} catch (error) {
  await pool.end();
  console.error(error);
  process.exit(1);
}
