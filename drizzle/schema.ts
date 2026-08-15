import { boolean, index, int, json, mysqlEnum, mysqlTable, text, timestamp, unique, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 96 }).notNull().unique(),
  username: varchar("username", { length: 64 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const roles = mysqlTable("iam_role", {
  id: int("id").autoincrement().primaryKey(), code: varchar("code", { length: 64 }).notNull().unique(), name: varchar("name", { length: 120 }).notNull(), description: text("description"), scope: mysqlEnum("scope", ["system", "workflow"]).notNull(), isSystem: boolean("isSystem").default(false).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export const permissions = mysqlTable("iam_permission", { id: int("id").autoincrement().primaryKey(), code: varchar("code", { length: 80 }).notNull().unique(), name: varchar("name", { length: 120 }).notNull() });
export const rolePermissions = mysqlTable("iam_role_permission", { id: int("id").autoincrement().primaryKey(), roleId: int("roleId").notNull().references(() => roles.id), permissionId: int("permissionId").notNull().references(() => permissions.id) }, table => [unique("role_permission_unique").on(table.roleId, table.permissionId)]);
export const roleAssignments = mysqlTable("iam_role_assignment", { id: int("id").autoincrement().primaryKey(), userId: int("userId").notNull().references(() => users.id), roleId: int("roleId").notNull().references(() => roles.id), expiresAt: timestamp("expiresAt"), revokedAt: timestamp("revokedAt"), createdAt: timestamp("createdAt").defaultNow().notNull() }, table => [index("role_assignment_user_idx").on(table.userId)]);
export const sessions = mysqlTable("iam_session", { id: varchar("id", { length: 64 }).primaryKey(), userId: int("userId").notNull().references(() => users.id), tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(), expiresAt: timestamp("expiresAt").notNull(), revokedAt: timestamp("revokedAt"), createdAt: timestamp("createdAt").defaultNow().notNull() }, table => [index("session_user_idx").on(table.userId)]);

export const workflows = mysqlTable("workflow", { id: varchar("id", { length: 32 }).primaryKey(), ownerUserId: int("ownerUserId").notNull().references(() => users.id), name: varchar("name", { length: 160 }).notNull(), description: text("description"), status: mysqlEnum("status", ["draft", "published"]).default("draft").notNull(), definitionVersion: int("definitionVersion").default(1).notNull(), definitionJson: json("definitionJson").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull() }, table => [index("workflow_owner_updated_idx").on(table.ownerUserId, table.updatedAt)]);
export const workflowMembers = mysqlTable("workflow_member", { id: int("id").autoincrement().primaryKey(), workflowId: varchar("workflowId", { length: 32 }).notNull().references(() => workflows.id), userId: int("userId").notNull().references(() => users.id), role: mysqlEnum("role", ["owner", "editor", "operator", "viewer"]).notNull(), expiresAt: timestamp("expiresAt"), revokedAt: timestamp("revokedAt"), createdAt: timestamp("createdAt").defaultNow().notNull() }, table => [unique("workflow_member_unique").on(table.workflowId, table.userId, table.role)]);
export const workflowRuns = mysqlTable("workflow_run", { id: varchar("id", { length: 32 }).primaryKey(), workflowId: varchar("workflowId", { length: 32 }).notNull().references(() => workflows.id), ownerUserId: int("ownerUserId").notNull().references(() => users.id), triggeredByUserId: int("triggeredByUserId").references(() => users.id), triggerType: mysqlEnum("triggerType", ["manual", "api", "schedule"]).notNull(), status: mysqlEnum("status", ["queued", "running", "success", "failed", "cancelled"]).default("queued").notNull(), definitionSnapshotJson: json("definitionSnapshotJson").notNull(), inputJson: json("inputJson").notNull(), contextJson: json("contextJson").notNull(), authorizationSnapshotJson: json("authorizationSnapshotJson"), finalOutputJson: json("finalOutputJson"), errorJson: json("errorJson"), startedAt: timestamp("startedAt"), finishedAt: timestamp("finishedAt"), durationMs: int("durationMs"), createdAt: timestamp("createdAt").defaultNow().notNull() }, table => [index("workflow_run_workflow_idx").on(table.workflowId, table.createdAt)]);
export const workflowNodeRuns = mysqlTable("workflow_node_run", { id: varchar("id", { length: 32 }).primaryKey(), runId: varchar("runId", { length: 32 }).notNull().references(() => workflowRuns.id), nodeId: varchar("nodeId", { length: 64 }).notNull(), nodeType: varchar("nodeType", { length: 32 }).notNull(), nodeName: varchar("nodeName", { length: 160 }).notNull(), status: mysqlEnum("status", ["pending", "running", "success", "failed", "skipped"]).notNull(), inputJson: json("inputJson").notNull(), outputJson: json("outputJson"), errorJson: json("errorJson"), durationMs: int("durationMs"), createdAt: timestamp("createdAt").defaultNow().notNull() });

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
