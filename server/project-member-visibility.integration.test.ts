import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, expect, it } from "vitest";
import {
  createProject,
  grantProjectMember,
  listProjectMembers,
  revokeProjectMember,
} from "./project-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
let pool: mysql.Pool | undefined;
let projectId: string | undefined;
let userIds: number[] = [];

afterAll(async () => {
  if (!pool) return;
  if (projectId) {
    await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [
      projectId,
    ]);
    await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
  }
  if (userIds.length) {
    await pool.query(
      "DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)",
      [userIds, userIds]
    );
    await pool.query("DELETE FROM users WHERE id IN (?)", [userIds]);
  }
  await pool.end();
});

runIntegration(
  "项目可见成员仅包含当前生效授权；撤销、到期、未生效与停用账号不会继续显示",
  async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    const ownerName = `member_owner_${suffix}`;
    const memberName = `member_viewer_${suffix}`;
    await pool.query(
      "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,'admin','active','internal',NOW()),(?,?,?,'user','active','internal',NOW())",
      [
        `test:${ownerName}`,
        ownerName,
        "成员可见性所有者",
        `test:${memberName}`,
        memberName,
        "成员可见性查看者",
      ]
    );
    const [users] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id,username FROM users WHERE username IN (?,?)",
      [ownerName, memberName]
    );
    userIds = users.map(user => Number(user.id));
    const owner = {
      id: Number(users.find(user => user.username === ownerName)!.id),
      role: "admin" as const,
    };
    const memberId = Number(
      users.find(user => user.username === memberName)!.id
    );
    projectId = await createProject(owner, {
      code: `MV_${suffix}`,
      name: "成员授权显示验收",
    });
    const visibleMember = async () =>
      (await listProjectMembers(owner, projectId!)).find(
        member => Number(member.userId) === memberId
      );

    await grantProjectMember(owner, {
      projectId,
      userId: memberId,
      role: "viewer",
    });
    expect(await visibleMember()).toMatchObject({
      role: "viewer",
      username: memberName,
    });
    expect(await visibleMember()).not.toHaveProperty("email");
    await revokeProjectMember(owner, { projectId, userId: memberId });
    expect(await visibleMember()).toBeUndefined();
    const [revoked] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT revokedAt FROM flow_project_member WHERE projectId=? AND userId=?",
      [projectId, memberId]
    );
    expect(revoked[0].revokedAt).toBeTruthy();

    await grantProjectMember(owner, {
      projectId,
      userId: memberId,
      role: "viewer",
    });
    await pool.query(
      "UPDATE flow_project_member SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE projectId=? AND userId=?",
      [projectId, memberId]
    );
    expect(await visibleMember()).toBeUndefined();
    await pool.query(
      "UPDATE flow_project_member SET expiresAt=NULL,effectiveFrom=DATE_ADD(NOW(),INTERVAL 1 MINUTE) WHERE projectId=? AND userId=?",
      [projectId, memberId]
    );
    expect(await visibleMember()).toBeUndefined();
    await pool.query(
      "UPDATE flow_project_member SET effectiveFrom=NOW() WHERE projectId=? AND userId=?",
      [projectId, memberId]
    );
    await pool.query("UPDATE users SET status='disabled' WHERE id=?", [
      memberId,
    ]);
    expect(await visibleMember()).toBeUndefined();
    await pool.query("UPDATE users SET status='active' WHERE id=?", [memberId]);
    expect(await visibleMember()).toMatchObject({ role: "viewer" });
  },
  30_000
);
