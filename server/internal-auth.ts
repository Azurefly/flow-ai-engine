import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import type { User } from "../drizzle/schema";
import { getSharedPool } from "./db";
import {
  ensureIamCatalog,
  hasSystemPermission,
  recordAuthorizationAudit,
} from "./iam-service";
import {
  changeAccountStatus,
  type AccountStatusChange,
} from "./account-status";

const scrypt = promisify(scryptCallback);
const SESSION_MAX_SECONDS = 60 * 60 * 24 * 7;
export const FLOW_SESSION_COOKIE = "flow_session";

function db() {
  return getSharedPool();
}

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${digest.toString("hex")}`;
}
async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded?.includes(":")) return false;
  const [salt, hex] = encoded.split(":");
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return expected.length === digest.length && timingSafeEqual(expected, digest);
}

export async function ensureBootstrapAdmin() {
  const username =
    process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) return;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  if (rows[0]) return;
  const passwordHash = await hashPassword(password);
  await db().query(
    "INSERT INTO users (openId, username, passwordHash, name, role, status, loginMethod, lastSignedIn) VALUES (?, ?, ?, ?, 'admin', 'active', 'internal', NOW())",
    [`internal:${username}`, username, passwordHash, "System Administrator"]
  );
}

export async function authenticateToken(token?: string): Promise<User | null> {
  if (!token) return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT u.* FROM auth_session s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.revokedAt IS NULL AND s.expiresAt>NOW() AND u.status='active' LIMIT 1",
    [tokenHash(token)]
  );
  return (rows[0] as User | undefined) ?? null;
}

export async function login(
  username: string,
  password: string,
  userAgent?: string
) {
  await ensureBootstrapAdmin();
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM users WHERE username=? AND status='active' LIMIT 1",
    [username.trim().toLowerCase()]
  );
  const user = rows[0] as User | undefined;
  if (!user || !(await verifyPassword(password, user.passwordHash ?? null))) {
    await recordAuthorizationAudit({
      action: "login_failed",
      resourceType: "auth",
      details: { username: username.trim().toLowerCase() },
    });
    return null;
  }
  const token = randomBytes(32).toString("base64url");
  const id = randomBytes(18).toString("hex");
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [current] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM users WHERE id=? FOR UPDATE",
      [user.id]
    );
    const locked = current[0] as User | undefined;
    if (
      !locked ||
      locked.status !== "active" ||
      locked.tokenVersion !== user.tokenVersion ||
      locked.passwordHash !== user.passwordHash
    ) {
      await connection.rollback();
      return null;
    }
    await connection.query(
      "INSERT INTO auth_session (id,userId,tokenHash,expiresAt,userAgent) VALUES (?,?,?,?,?)",
      [
        id,
        user.id,
        tokenHash(token),
        new Date(Date.now() + SESSION_MAX_SECONDS * 1000),
        userAgent?.slice(0, 255) ?? null,
      ]
    );
    await connection.query("UPDATE users SET lastSignedIn=NOW() WHERE id=?", [
      user.id,
    ]);
    await recordAuthorizationAudit(
      {
        actorUserId: user.id,
        targetUserId: user.id,
        action: "login_success",
        resourceType: "auth",
      },
      connection
    );
    await connection.commit();
    return { user: locked, token };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function logout(token?: string, actorUserId?: number) {
  if (!token) return;
  await db().query(
    "UPDATE auth_session SET revokedAt=NOW() WHERE tokenHash=?",
    [tokenHash(token)]
  );
  await recordAuthorizationAudit({
    actorUserId,
    targetUserId: actorUserId,
    action: "logout",
    resourceType: "auth",
  });
}
export async function listUsers() {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,username,name,email,role,status,tokenVersion AS statusVersion,lastSignedIn,createdAt FROM users ORDER BY createdAt DESC"
  );
  return rows;
}
export async function listUsersPage(input: {
  search: string;
  offset: number;
  limit: number;
  status?: "active" | "disabled";
}) {
  const search = input.search.trim().toLowerCase();
  const conditions: string[] = [];
  const queryArgs: Array<string | number> = [];
  if (search) {
    conditions.push(
      "(INSTR(LOWER(COALESCE(name, '')), ?) > 0 OR INSTR(LOWER(username), ?) > 0 OR INSTR(LOWER(COALESCE(email, '')), ?) > 0)"
    );
    queryArgs.push(search, search, search);
  }
  if (input.status) {
    conditions.push("status=?");
    queryArgs.push(input.status);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const [countRows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM users${where}`,
    queryArgs
  );
  const total = Number(countRows[0]?.total ?? 0);
  const [items] = await db().query<mysql.RowDataPacket[]>(
    `SELECT id,username,name,email,role,status,tokenVersion AS statusVersion,lastSignedIn,createdAt FROM users${where} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`,
    [...queryArgs, input.limit, input.offset]
  );
  return { items, total, offset: input.offset, limit: input.limit };
}
export type UserCreationAudit = {
  actorUserId: number;
  actorTokenVersion?: number;
  details?: Record<string, unknown>;
};

export async function createUser(
  values: {
    username: string;
    password: string;
    name: string;
    email?: string | null;
    role?: "user" | "admin";
  },
  audit?: UserCreationAudit
) {
  if (values.password.length < 12) throw new Error("密码至少需要 12 位。");
  if (!/[a-zA-Z]/.test(values.password) || !/[0-9\W_]/.test(values.password)) {
    throw new Error("密码需包含字母以及数字或特殊符号。");
  }
  const username = values.username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username))
    throw new Error("用户名格式无效。");
  const passwordHash = await hashPassword(values.password);
  const insert = async (executor: mysql.Pool | mysql.PoolConnection) => {
    try {
      const [result] = await executor.query<mysql.ResultSetHeader>(
        "INSERT INTO users (openId,username,passwordHash,name,email,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,'active','internal',NOW())",
        [
          `internal:${username}`,
          username,
          passwordHash,
          values.name.trim(),
          values.email ?? null,
          values.role ?? "user",
        ]
      );
      return result.insertId;
    } catch (error) {
      const failure = error as {
        code?: string;
        errno?: number;
        message?: string;
      };
      if (
        (failure?.code === "ER_DUP_ENTRY" || failure?.errno === 1062) &&
        /users_(?:username|openId)_unique/.test(failure.message ?? "")
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "用户名已存在，请更换用户名。",
          cause: error,
        });
      throw error;
    }
  };
  if (!audit) return insert(db());

  // Hashing and catalog initialization finish before acquiring row locks.
  await ensureIamCatalog();
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await db().getConnection();
    try {
      await connection.beginTransaction();
      // The actor predates the newly inserted user. Lock it first, matching the
      // ascending user lock order used by account-status protection.
      const [actors] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,role,status,tokenVersion FROM users WHERE id=? FOR UPDATE",
        [audit.actorUserId]
      );
      const actor = actors[0];
      if (
        !actor ||
        actor.status !== "active" ||
        (audit.actorTokenVersion !== undefined &&
          Number(actor.tokenVersion) !== audit.actorTokenVersion) ||
        !(await hasSystemPermission(
          { id: Number(actor.id), role: actor.role },
          "iam:manage",
          connection
        ))
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "当前账号无权创建人员，请刷新权限后重试。",
        });
      const userId = await insert(connection);
      await recordAuthorizationAudit(
        {
          actorUserId: audit.actorUserId,
          targetUserId: userId,
          action: "user_created",
          resourceType: "user",
          resourceId: String(userId),
          details: audit.details,
        },
        connection
      );
      await connection.commit();
      return userId;
    } catch (error) {
      await connection.rollback();
      const failure = error as { code?: string; errno?: number };
      const deadlock =
        failure?.code === "ER_LOCK_DEADLOCK" || failure?.errno === 1213;
      if (!deadlock) throw error;
      if (attempt === 2)
        throw new TRPCError({
          code: "CONFLICT",
          message: "人员信息正在被其他管理员更新，本次账号未创建，请稍后重试。",
          cause: error,
        });
    } finally {
      connection.release();
    }
    // Only a deadlock reaches here: MySQL rolled back the entire transaction.
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("账号创建事务未完成。");
}
export async function setUserStatus(
  userId: number,
  status: "active" | "disabled",
  options: Omit<AccountStatusChange, "userId" | "status"> = {}
) {
  return changeAccountStatus({ ...options, userId, status });
}
