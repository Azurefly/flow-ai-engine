import mysql from "mysql2/promise";
import { createUser } from "../server/internal-auth";
import { createCustomRole, assignRole } from "../server/iam-service";
import { assignOrganizationMember, createOrganizationUnit } from "../server/organization-service";
import { createProject, createProjectWorkflow, grantProjectMember, setProjectWorkflowAudit } from "../server/project-service";
import { updateWorkflow, type Definition } from "../server/workflow-service";
import { createAnnualLeaveApprovalDefinition, createReportingApprovalDefinition, createResignationApprovalDefinition } from "../shared/company-workflows";

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.COMPANY_DEMO_PASSWORD;
const suffix = (process.env.COMPANY_DEMO_SUFFIX || new Date().toISOString().replace(/\D/g, "").slice(0, 12)).toLowerCase();
if (!databaseUrl) throw new Error("DATABASE_URL 未配置。");
if (!password || password.length < 12) throw new Error("COMPANY_DEMO_PASSWORD 必须至少 12 个字符。");
if (!/^[a-z0-9]{6,24}$/.test(suffix)) throw new Error("COMPANY_DEMO_SUFFIX 只能包含 6 至 24 位小写字母或数字。");

const pool = mysql.createPool(databaseUrl);
const roleCode = `custom_company_approver_${suffix}`;
const usernames = {
  admin: `company_admin_${suffix}`,
  ceo: `company_ceo_${suffix}`,
  hr1: `company_hr1_${suffix}`,
  hr2: `company_hr2_${suffix}`,
  manager: `company_manager_${suffix}`,
  deputy: `company_deputy_${suffix}`,
  ...Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`employee${index + 1}`, `company_employee${index + 1}_${suffix}`])),
} as Record<string, string>;

async function ensureUsers() {
  const [existing] = await pool.query<mysql.RowDataPacket[]>("SELECT username FROM users WHERE username LIKE ?", [`company_%_${suffix}`]);
  if (existing.length) throw new Error("同一 COMPANY_DEMO_SUFFIX 已存在数据，为避免覆盖既有演示，请更换 COMPANY_DEMO_SUFFIX。");
  await createUser({ username: usernames.admin, password, name: "公司演示管理员", role: "admin" });
  await createUser({ username: usernames.ceo, password, name: "公司总经理", role: "user" });
  await createUser({ username: usernames.hr1, password, name: "人力资源负责人", role: "user" });
  await createUser({ username: usernames.hr2, password, name: "人力资源审批人", role: "user" });
  await createUser({ username: usernames.manager, password, name: "研发部经理", role: "user" });
  await createUser({ username: usernames.deputy, password, name: "产品部经理", role: "user" });
  for (let index = 1; index <= 11; index += 1) await createUser({ username: usernames[`employee${index}`], password, name: `演示员工${index}`, role: "user" });
  const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username LIKE ?", [`company_%_${suffix}`]);
  return new Map(rows.map(row => [String(row.username), row]));
}

async function main() {
  const users = await ensureUsers();
  const admin = users.get(usernames.admin)!;
  const ceo = users.get(usernames.ceo)!;
  const hr1 = users.get(usernames.hr1)!;
  const hr2 = users.get(usernames.hr2)!;
  const manager = users.get(usernames.manager)!;
  const deputy = users.get(usernames.deputy)!;
  const root = await createOrganizationUnit(admin, { code: `HQ_${suffix.toUpperCase()}`, name: "星河科技总部", managerUserId: ceo.id, unitType: "总部", category: "公司" });
  const engineering = await createOrganizationUnit(admin, { code: `ENG_${suffix.toUpperCase()}`, name: "研发中心", parentUnitId: root, managerUserId: manager.id, unitType: "中心", category: "研发" });
  const product = await createOrganizationUnit(admin, { code: `PROD_${suffix.toUpperCase()}`, name: "产品中心", parentUnitId: root, managerUserId: deputy.id, unitType: "中心", category: "产品" });
  const hr = await createOrganizationUnit(admin, { code: `HR_${suffix.toUpperCase()}`, name: "人力资源部", parentUnitId: root, managerUserId: hr1.id, unitType: "部门", category: "职能" });
  await assignOrganizationMember(admin, { unitId: root, userId: ceo.id, title: "总经理", isPrimary: true });
  await assignOrganizationMember(admin, { unitId: engineering, userId: manager.id, title: "研发经理", isPrimary: true });
  await assignOrganizationMember(admin, { unitId: product, userId: deputy.id, title: "产品经理", isPrimary: true });
  await assignOrganizationMember(admin, { unitId: hr, userId: hr1.id, title: "人力负责人", isPrimary: true });
  await assignOrganizationMember(admin, { unitId: hr, userId: hr2.id, title: "HR 审批人", isPrimary: false });
  for (let index = 1; index <= 7; index += 1) await assignOrganizationMember(admin, { unitId: engineering, userId: users.get(usernames[`employee${index}`])!.id, title: "研发工程师", isPrimary: true });
  for (let index = 8; index <= 11; index += 1) await assignOrganizationMember(admin, { unitId: product, userId: users.get(usernames[`employee${index}`])!.id, title: "产品专员", isPrimary: true });

  await createCustomRole({ code: roleCode, name: "公司流程审批人", description: "辞职、汇报、年假演示流程审批角色", scope: "system", permissions: ["workflow:view", "workflow:run"], actorUserId: admin.id });
  for (const approver of [ceo, hr1, hr2, manager, deputy]) await assignRole({ userId: approver.id, roleCode, scopeType: "system", grantedByUserId: admin.id });

  const project = await createProject(admin, { code: `CO${suffix.slice(0, 10).toUpperCase()}`, name: "公司人事流程演示", description: "组织架构、辞职审批、多人汇报和年假分支流程。" });
  const allUsers = Array.from(users.values()).filter(user => user.id !== admin.id);
  for (const user of allUsers) await grantProjectMember(admin, { projectId: project, userId: user.id, role: "operator" });
  const definitions: Array<[string, string, Definition]> = [
    ["RESIGN", "多人辞职审批流程", createResignationApprovalDefinition(roleCode) as Definition],
    ["REPORT", "多人汇报审批流程", createReportingApprovalDefinition(roleCode) as Definition],
    ["ANNUAL", "年假审批流程（按天数分支）", createAnnualLeaveApprovalDefinition(roleCode) as Definition],
  ];
  const workflowIds: Record<string, string> = {};
  for (const [code, name, definition] of definitions) {
    const workflow = await createProjectWorkflow(admin, { projectId: project, processCode: `${code}_${suffix.toUpperCase()}`, name, description: name, flowType: "state", definition });
    workflowIds[code] = workflow.id;
    await setProjectWorkflowAudit(admin, { projectId: project, workflowId: workflow.id, auditStatus: "approved" });
    await updateWorkflow(workflow.id, admin, { publish: true });
  }
  console.log(JSON.stringify({ suffix, projectId: project, workflowIds, roleCode, employeeCount: 11, usernames }, null, 2));
}

try { await main(); await pool.end(); process.exit(0); } catch (error) { await pool.end(); console.error(error); process.exit(1); }

