import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";

/** Internal identities. The physical table is retained from the recovery database. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).unique(),
  username: varchar("username", { length: 64 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: varchar("name", { length: 160 }),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
  tokenVersion: int("tokenVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/** Hashed, revocable browser sessions. */
export const sessions = mysqlTable(
  "auth_session",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    userAgent: varchar("userAgent", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("auth_session_user_idx").on(table.userId)],
);

export const roles = mysqlTable("iam_role", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  scope: mysqlEnum("scope", ["system", "workflow"]).notNull(),
  isSystem: boolean("isSystem").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const permissions = mysqlTable("permission", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 96 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const rolePermissions = mysqlTable(
  "role_permission",
  {
    id: int("id").autoincrement().primaryKey(),
    roleId: int("roleId").notNull().references(() => roles.id),
    permissionId: int("permissionId").notNull().references(() => permissions.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("role_permission_unique_idx").on(table.roleId, table.permissionId)],
);

/** System or resource-scoped grants. expiresAt creates a temporary role automatically. */
export const roleAssignments = mysqlTable(
  "role_assignment",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    roleId: int("roleId").notNull().references(() => roles.id),
    scopeType: mysqlEnum("scopeType", ["system", "workflow"]).notNull(),
    scopeId: varchar("scopeId", { length: 36 }),
    effectiveFrom: timestamp("effectiveFrom").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
    revokedAt: timestamp("revokedAt"),
    grantedByUserId: int("grantedByUserId").references(() => users.id),
    revokedByUserId: int("revokedByUserId").references(() => users.id),
    note: varchar("note", { length: 320 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("role_assignment_user_idx").on(table.userId)],
);

export const workflows = mysqlTable(
  "workflow",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerUserId: int("ownerUserId").notNull().references(() => users.id),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["draft", "published"]).default("draft").notNull(),
    definitionVersion: int("definitionVersion").default(1).notNull(),
    definitionJson: json("definitionJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("workflow_owner_updated_idx").on(table.ownerUserId, table.updatedAt)],
);

export const workflowMembers = mysqlTable(
  "workflow_member",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 }).notNull().references(() => workflows.id),
    userId: int("userId").notNull().references(() => users.id),
    role: mysqlEnum("role", ["owner", "editor", "operator", "viewer"]).notNull(),
    effectiveFrom: timestamp("effectiveFrom").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
    revokedAt: timestamp("revokedAt"),
    grantedByUserId: int("grantedByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("workflow_member_unique").on(table.workflowId, table.userId, table.role)],
);

export const workflowRuns = mysqlTable(
  "workflow_run",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 }).notNull().references(() => workflows.id),
    ownerUserId: int("ownerUserId").notNull().references(() => users.id),
    triggerType: mysqlEnum("triggerType", ["manual", "api", "schedule"]).default("manual").notNull(),
    status: mysqlEnum("status", ["queued", "running", "success", "failed", "cancelled"]).default("queued").notNull(),
    definitionSnapshotJson: json("definitionSnapshotJson").notNull(),
    inputJson: json("inputJson").notNull(),
    contextJson: json("contextJson").notNull(),
    finalOutputJson: json("finalOutputJson"),
    errorJson: json("errorJson"),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    durationMs: int("durationMs"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    executionLockToken: varchar("executionLockToken", { length: 48 }),
    executionLockExpiresAt: timestamp("executionLockExpiresAt"),
    triggeredByUserId: int("triggeredByUserId").references(() => users.id),
    authorizationSnapshotJson: json("authorizationSnapshotJson"),
  },
  table => [index("workflow_run_workflow_idx").on(table.workflowId, table.createdAt)],
);

export const workflowNodeRuns = mysqlTable("workflow_node_run", {
  id: varchar("id", { length: 36 }).primaryKey(),
  runId: varchar("runId", { length: 36 }).notNull().references(() => workflowRuns.id),
  nodeId: varchar("nodeId", { length: 120 }).notNull(),
  nodeType: varchar("nodeType", { length: 48 }).notNull(),
  nodeName: varchar("nodeName", { length: 160 }).notNull(),
  status: mysqlEnum("status", ["pending", "running", "success", "failed", "skipped"]).default("pending").notNull(),
  inputJson: json("inputJson").notNull(),
  outputJson: json("outputJson"),
  errorJson: json("errorJson"),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Immutable definition snapshots created on every edit, publish, and rollback. */
export const workflowVersions = mysqlTable(
  "workflow_version",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 }).notNull().references(() => workflows.id),
    version: int("version").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: mysqlEnum("status", ["draft", "published"]).notNull(),
    definitionJson: json("definitionJson").notNull(),
    changeSource: mysqlEnum("changeSource", ["created", "updated", "published", "rolled_back"]).notNull(),
    restoredFromVersion: int("restoredFromVersion"),
    createdByUserId: int("createdByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    unique("workflow_version_workflow_version_unique").on(table.workflowId, table.version),
    index("workflow_version_workflow_created_idx").on(table.workflowId, table.createdAt),
  ],
);

/** Per-recipient failed-run notifications; access never depends on another tenant's records. */
export const workflowRunAlerts = mysqlTable(
  "workflow_run_alert",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 }).notNull().references(() => workflows.id),
    runId: varchar("runId", { length: 36 }).notNull().references(() => workflowRuns.id),
    recipientUserId: int("recipientUserId").notNull().references(() => users.id),
    severity: mysqlEnum("severity", ["warning", "critical"]).default("critical").notNull(),
    summary: varchar("summary", { length: 320 }).notNull(),
    detailsJson: json("detailsJson"),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("workflow_run_alert_recipient_idx").on(table.recipientUserId, table.readAt, table.createdAt),
    index("workflow_run_alert_workflow_idx").on(table.workflowId, table.createdAt),
  ],
);

/** Private, user-owned node templates that can be inserted into any authorized workflow. */
export const workflowNodeTemplates = mysqlTable(
  "workflow_node_template",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerUserId: int("ownerUserId").notNull().references(() => users.id),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 500 }),
    nodeType: varchar("nodeType", { length: 48 }).notNull(),
    configJson: json("configJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("workflow_node_template_owner_updated_idx").on(table.ownerUserId, table.updatedAt)],
);

/** Private, user-owned executable definitions referenced by subflow nodes. */
export const workflowSubflows = mysqlTable(
  "workflow_subflow",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerUserId: int("ownerUserId").notNull().references(() => users.id),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 500 }),
    definitionJson: json("definitionJson").notNull(),
    isEnabled: boolean("isEnabled").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("workflow_subflow_owner_updated_idx").on(table.ownerUserId, table.updatedAt)],
);

export const authorizationAuditLogs = mysqlTable("authorization_audit_log", {
  id: varchar("id", { length: 36 }).primaryKey(),
  actorUserId: int("actorUserId").references(() => users.id),
  targetUserId: int("targetUserId").references(() => users.id),
  action: mysqlEnum("action", [
    "login_success",
    "login_failed",
    "logout",
    "user_created",
    "user_updated",
    "user_disabled",
    "role_assigned",
    "role_revoked",
    "temporary_role_assigned",
    "temporary_role_revoked",
  ]).notNull(),
  resourceType: varchar("resourceType", { length: 64 }),
  resourceId: varchar("resourceId", { length: 64 }),
  detailsJson: json("detailsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
