import type { User } from "../drizzle/schema";
import { hasSystemPermission } from "./iam-service";

/** Public account data is an explicit projection of the authenticated record. */
export async function publicAuthAccount(user: User | null) {
  if (!user || user.status !== "active") return null;
  return {
    id: user.id,
    openId: user.openId,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    loginMethod: user.loginMethod,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastSignedIn: user.lastSignedIn,
    canManageIdentity: await hasSystemPermission(user, "iam:manage"),
  };
}
