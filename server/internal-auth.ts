import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import mysql from "mysql2/promise";
import type { User } from "../drizzle/schema";
import { getSharedPool } from "./db";
import { recordAuthorizationAudit } from "./iam-service";

const scrypt = promisify(scryptCallback);
const SESSION_MAX_SECONDS = 60 * 60 * 24 * 7;
export const FLOW_SESSION_COOKIE = "flow_session";

function db() {
  return getSharedPool();
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
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
  const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) return;
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
  if (rows[0]) return;
  const passwordHash = await hashPassword(password);
  await db().query("INSERT INTO users (openId, username, passwordHash, name, role, status, loginMethod, lastSignedIn) VALUES (?, ?, ?, ?, 'admin', 'active', 'internal', NOW())", [`internal:${username}`, username, passwordHash, "System Administrator"]);
}

export async function authenticateToken(token?: string): Promise<User | null> {
  if (!token) return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT u.* FROM auth_session s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.revokedAt IS NULL AND s.expiresAt>NOW() AND u.status='active' LIMIT 1", [tokenHash(token)]);
  return (rows[0] as User | undefined) ?? null;
}

export async function login(username: string, password: string, userAgent?: string) {
  await ensureBootstrapAdmin();
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username=? AND status='active' LIMIT 1", [username.trim().toLowerCase()]);
  const user = rows[0] as User | undefined;
  if (!user || !(await verifyPassword(password, user.passwordHash ?? null))) {
    await recordAuthorizationAudit({ action: "login_failed", resourceType: "auth", details: { username: username.trim().toLowerCase() } });
    return null;
  }
  const token = randomBytes(32).toString("base64url");
  const id = randomBytes(18).toString("hex");
  await db().query("INSERT INTO auth_session (id,userId,tokenHash,expiresAt,userAgent) VALUES (?,?,?,?,?)", [id, user.id, tokenHash(token), new Date(Date.now() + SESSION_MAX_SECONDS * 1000), userAgent?.slice(0, 255) ?? null]);
  await db().query("UPDATE users SET lastSignedIn=NOW() WHERE id=?", [user.id]);
  await recordAuthorizationAudit({ actorUserId: user.id, targetUserId: user.id, action: "login_success", resourceType: "auth" });
  return { user, token };
}

export async function logout(token?: string, actorUserId?: number) {
  if (!token) return;
  await db().query("UPDATE auth_session SET revokedAt=NOW() WHERE tokenHash=?", [tokenHash(token)]);
  await recordAuthorizationAudit({ actorUserId, targetUserId: actorUserId, action: "logout", resourceType: "auth" });
}
export async function listUsers() { const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT id,username,name,email,role,status,lastSignedIn,createdAt FROM users ORDER BY createdAt DESC"); return rows; }
export async function createUser(values: { username: string; password: string; name: string; email?: string | null; role?: "user" | "admin" }) {
  if (values.password.length < 12) throw new Error("密码至少需要 12 位。");
  if (!/[a-zA-Z]/.test(values.password) || !/[0-9\W_]/.test(values.password)) {
    throw new Error("密码需包含字母以及数字或特殊符号。");
  }
  const username = values.username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username)) throw new Error("用户名格式无效。");
  const passwordHash = await hashPassword(values.password);
  const [result] = await db().query<mysql.ResultSetHeader>("INSERT INTO users (openId,username,passwordHash,name,email,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,'active','internal',NOW())", [`internal:${username}`, username, passwordHash, values.name.trim(), values.email ?? null, values.role ?? "user"]);
  return result.insertId;
}
export async function setUserStatus(userId: number, status: "active" | "disabled") { await db().query("UPDATE users SET status=? WHERE id=?", [status, userId]); if (status === "disabled") await db().query("UPDATE auth_session SET revokedAt=NOW() WHERE userId=? AND revokedAt IS NULL", [userId]); }
