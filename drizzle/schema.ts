import { boolean, index, int, json, mysqlEnum, mysqlTable, text, timestamp, unique, varchar } from "drizzle-orm/mysql-core";

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

/** Original-compatible organization tree used to resolve departments and direct superiors. */
export const organizationUnits = mysqlTable(
  "organization_unit",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    code: varchar("code", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    parentUnitId: varchar("parentUnitId", { length: 36 }),
    managerUserId: int("managerUserId").references(() => users.id),
    unitType: varchar("unitType", { length: 64 }),
    unitLevel: int("unitLevel"),
    standardCode: varchar("standardCode", { length: 96 }),
    areaCode: varchar("areaCode", { length: 96 }),
    category: varchar("category", { length: 96 }),
    sortOrder: int("sortOrder").default(0).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("organization_unit_parent_idx").on(table.parentUnitId), index("organization_unit_manager_idx").on(table.managerUserId)]
);

/** A user may belong to multiple units; one primary unit drives direct-superior resolution. */
export const organizationMemberships = mysqlTable(
  "organization_membership",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    unitId: varchar("unitId", { length: 36 })
      .notNull()
      .references(() => organizationUnits.id),
    userId: int("userId")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 160 }),
    isPrimary: boolean("isPrimary").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("organization_membership_unit_user_unique").on(table.unitId, table.userId), index("organization_membership_user_primary_idx").on(table.userId, table.isPrimary)]
);

/** Hashed, revocable browser sessions. */
export const sessions = mysqlTable(
  "auth_session",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    userAgent: varchar("userAgent", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("auth_session_user_idx").on(table.userId)]
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

/** Department members inherit these system-scoped IAM roles in real time. */
export const organizationUnitRoles = mysqlTable(
  "organization_unit_role",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    unitId: varchar("unitId", { length: 36 })
      .notNull()
      .references(() => organizationUnits.id),
    roleId: int("roleId")
      .notNull()
      .references(() => roles.id),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("organization_unit_role_unique").on(table.unitId, table.roleId), index("organization_unit_role_role_idx").on(table.roleId)]
);

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
    roleId: int("roleId")
      .notNull()
      .references(() => roles.id),
    permissionId: int("permissionId")
      .notNull()
      .references(() => permissions.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("role_permission_unique_idx").on(table.roleId, table.permissionId)]
);

/** System or resource-scoped grants. expiresAt creates a temporary role automatically. */
export const roleAssignments = mysqlTable(
  "role_assignment",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id),
    roleId: int("roleId")
      .notNull()
      .references(() => roles.id),
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
  table => [index("role_assignment_user_idx").on(table.userId)]
);

/** Original business/project workspace; project data is isolated from other tenants. */
export const flowProjects = mysqlTable(
  "flow_project",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id),
    domainId: varchar("domainId", { length: 36 }).references(() => workDomains.id),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("flow_project_owner_code_unique").on(table.ownerUserId, table.code), index("flow_project_owner_updated_idx").on(table.ownerUserId, table.updatedAt), index("flow_project_domain_updated_idx").on(table.domainId, table.updatedAt)]
);

/** Project roles mirror the original workspace boundary without weakening workflow-level IAM. */
export const flowProjectMembers = mysqlTable(
  "flow_project_member",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    userId: int("userId")
      .notNull()
      .references(() => users.id),
    role: mysqlEnum("role", ["owner", "designer", "operator", "viewer"]).notNull(),
    effectiveFrom: timestamp("effectiveFrom").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
    revokedAt: timestamp("revokedAt"),
    grantedByUserId: int("grantedByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("flow_project_member_unique").on(table.projectId, table.userId, table.role), index("flow_project_member_user_idx").on(table.userId, table.projectId)]
);

/** Hierarchical warehouse folders used for readonly discovery and workflow placement. */
export const workflowFolders = mysqlTable(
  "workflow_folder",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    parentId: varchar("parentId", { length: 36 }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("workflow_folder_project_parent_name_unique").on(table.projectId, table.parentId, table.name), index("workflow_folder_project_idx").on(table.projectId, table.parentId)]
);

export const workflows = mysqlTable(
  "workflow",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id),
    projectId: varchar("projectId", { length: 36 }).references(() => flowProjects.id),
    folderId: varchar("folderId", { length: 36 }).references(() => workflowFolders.id),
    processCode: varchar("processCode", { length: 64 }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    flowType: mysqlEnum("flowType", ["state", "control", "data"]).default("state").notNull(),
    creationSource: mysqlEnum("creationSource", ["manual", "warehouse"]).default("manual").notNull(),
    dataSourceId: varchar("dataSourceId", { length: 36 }),
    auditStatus: mysqlEnum("auditStatus", ["init", "approved", "rejected"]).default("init").notNull(),
    status: mysqlEnum("status", ["draft", "published"]).default("draft").notNull(),
    publishedAt: timestamp("publishedAt"),
    unpublishedAt: timestamp("unpublishedAt"),
    definitionVersion: int("definitionVersion").default(1).notNull(),
    definitionJson: json("definitionJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("workflow_owner_updated_idx").on(table.ownerUserId, table.updatedAt), index("workflow_project_updated_idx").on(table.projectId, table.updatedAt), index("workflow_folder_idx").on(table.folderId), index("workflow_data_source_idx").on(table.dataSourceId), unique("workflow_project_process_code_unique").on(table.projectId, table.processCode)]
);

export const workflowMembers = mysqlTable(
  "workflow_member",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    userId: int("userId")
      .notNull()
      .references(() => users.id),
    role: mysqlEnum("role", ["owner", "editor", "operator", "viewer"]).notNull(),
    effectiveFrom: timestamp("effectiveFrom").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
    revokedAt: timestamp("revokedAt"),
    grantedByUserId: int("grantedByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("workflow_member_unique").on(table.workflowId, table.userId, table.role)]
);

export const workflowRuns = mysqlTable(
  "workflow_run",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id),
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
    nextNodeSequence: int("nextNodeSequence").default(0).notNull(),
    executionLockToken: varchar("executionLockToken", { length: 48 }),
    executionLockExpiresAt: timestamp("executionLockExpiresAt"),
    triggeredByUserId: int("triggeredByUserId").references(() => users.id),
    authorizationSnapshotJson: json("authorizationSnapshotJson"),
  },
  table => [index("workflow_run_workflow_idx").on(table.workflowId, table.createdAt)]
);

export const workflowNodeRuns = mysqlTable(
  "workflow_node_run",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    runId: varchar("runId", { length: 36 })
      .notNull()
      .references(() => workflowRuns.id),
    sequenceNo: int("sequenceNo"),
    nodeId: varchar("nodeId", { length: 120 }).notNull(),
    nodeType: varchar("nodeType", { length: 48 }).notNull(),
    nodeName: varchar("nodeName", { length: 160 }).notNull(),
    status: mysqlEnum("status", ["pending", "running", "waiting", "success", "failed", "skipped"]).default("pending").notNull(),
    inputJson: json("inputJson").notNull(),
    outputJson: json("outputJson"),
    errorJson: json("errorJson"),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    durationMs: int("durationMs"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("workflow_node_run_sequence_unique").on(table.runId, table.sequenceNo)]
);

/** Durable coordination for original single/or-sign/and-sign operate semantics. */
export const workflowTaskGroups = mysqlTable(
  "workflow_task_group",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    runId: varchar("runId", { length: 36 })
      .notNull()
      .references(() => workflowRuns.id),
    nodeId: varchar("nodeId", { length: 120 }).notNull(),
    signMode: mysqlEnum("signMode", ["single", "orSignFor", "andSignFor"]).default("single").notNull(),
    totalApprovers: int("totalApprovers").default(1).notNull(),
    requiredApprovals: int("requiredApprovals").default(1).notNull(),
    passPercentBasisPoints: int("passPercentBasisPoints").default(10000).notNull(),
    status: mysqlEnum("status", ["waiting", "completed", "cancelled"]).default("waiting").notNull(),
    nextNodeIdsJson: json("nextNodeIdsJson").notNull(),
    completedByTaskId: varchar("completedByTaskId", { length: 36 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => [unique("workflow_task_group_run_node_unique").on(table.runId, table.nodeId), index("workflow_task_group_run_status_idx").on(table.runId, table.status)]
);

/** Human work created by an operate node; rows remain scoped to their workflow, run and project. */
export const workflowTasks = mysqlTable(
  "workflow_task",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    projectId: varchar("projectId", { length: 36 }).references(() => flowProjects.id),
    runId: varchar("runId", { length: 36 })
      .notNull()
      .references(() => workflowRuns.id),
    nodeId: varchar("nodeId", { length: 120 }).notNull(),
    nodeName: varchar("nodeName", { length: 160 }).notNull(),
    taskType: mysqlEnum("taskType", ["operate"]).default("operate").notNull(),
    status: mysqlEnum("status", ["pending", "claimed", "completed", "cancelled"]).default("pending").notNull(),
    assignedUserId: int("assignedUserId").references(() => users.id),
    candidateUserIdsJson: json("candidateUserIdsJson"),
    approvalGroupId: varchar("approvalGroupId", { length: 36 }).references(() => workflowTaskGroups.id),
    signMode: mysqlEnum("signMode", ["single", "orSignFor", "andSignFor"]).default("single").notNull(),
    roleKey: varchar("roleKey", { length: 160 }).default("default").notNull(),
    operationName: varchar("operationName", { length: 160 }),
    pendingStatusName: varchar("pendingStatusName", { length: 160 }),
    claimedByUserId: int("claimedByUserId").references(() => users.id),
    completedByUserId: int("completedByUserId").references(() => users.id),
    instruction: text("instruction"),
    payloadJson: json("payloadJson"),
    resultJson: json("resultJson"),
    nextNodeIdsJson: json("nextNodeIdsJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    claimedAt: timestamp("claimedAt"),
    completedAt: timestamp("completedAt"),
  },
  table => [index("workflow_task_assignee_status_idx").on(table.assignedUserId, table.status, table.createdAt), index("workflow_task_workflow_status_idx").on(table.workflowId, table.status, table.createdAt), index("workflow_task_approval_group_idx").on(table.approvalGroupId, table.status), unique("workflow_task_run_node_assignee_unique").on(table.runId, table.nodeId, table.assignedUserId)]
);

/** Per-user process status and available operations, mirroring the original people-centric state model. */
export const workflowParticipantStates = mysqlTable(
  "workflow_participant_state",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    runId: varchar("runId", { length: 36 })
      .notNull()
      .references(() => workflowRuns.id),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    userId: int("userId")
      .notNull()
      .references(() => users.id),
    roleKey: varchar("roleKey", { length: 160 }).default("default").notNull(),
    stateCode: varchar("stateCode", { length: 160 }),
    stateName: varchar("stateName", { length: 160 }).notNull(),
    flowStatus: varchar("flowStatus", { length: 255 }),
    stateColor: varchar("stateColor", { length: 32 }),
    sourceNodeId: varchar("sourceNodeId", { length: 160 }),
    availableOperationsJson: json("availableOperationsJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("workflow_participant_run_user_role_unique").on(table.runId, table.userId, table.roleKey), index("workflow_participant_user_updated_idx").on(table.userId, table.updatedAt)]
);

/** Administrator-owned settings for approval governance and visible system preferences. */
export const systemSettings = mysqlTable("system_setting", {
  key: varchar("key", { length: 96 }).primaryKey(),
  valueJson: json("valueJson").notNull(),
  updatedByUserId: int("updatedByUserId").references(() => users.id),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Named administrative work domains; projects remain their own data isolation boundary. */
export const workDomains = mysqlTable(
  "work_domain",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    code: varchar("code", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("work_domain_status_updated_idx").on(table.status, table.updatedAt)]
);

/** P2 project-scoped data-source metadata; credentials are referenced, never stored as plaintext. */
export const dataSources = mysqlTable(
  "data_source",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    name: varchar("name", { length: 160 }).notNull(),
    sourceType: mysqlEnum("sourceType", ["jdbc", "api", "file", "inline"]).notNull(),
    connectionJson: json("connectionJson").notNull(),
    credentialRef: varchar("credentialRef", { length: 255 }),
    status: mysqlEnum("status", ["draft", "verified", "disabled"]).default("draft").notNull(),
    lastTestedAt: timestamp("lastTestedAt"),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("data_source_project_name_unique").on(table.projectId, table.name), index("data_source_project_updated_idx").on(table.projectId, table.updatedAt)]
);

/** Discoverable project resources derived from a source, such as tables, files, endpoints and views. */
export const dataAssets = mysqlTable(
  "data_asset",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    sourceId: varchar("sourceId", { length: 36 }).references(() => dataSources.id),
    name: varchar("name", { length: 160 }).notNull(),
    assetType: mysqlEnum("assetType", ["table", "view", "file", "endpoint", "dataset"]).notNull(),
    schemaJson: json("schemaJson").notNull(),
    sampleJson: json("sampleJson"),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    discoveredAt: timestamp("discoveredAt").defaultNow().notNull(),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("data_asset_source_name_unique").on(table.sourceId, table.name), index("data_asset_project_updated_idx").on(table.projectId, table.updatedAt)]
);

/** Registered UDF metadata is project-scoped; execution remains subject to the dataflow sandbox policy. */
export const dataUdfs = mysqlTable(
  "data_udf",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    name: varchar("name", { length: 160 }).notNull(),
    udfType: mysqlEnum("udfType", ["sql", "javascript", "python", "jar"]).notNull(),
    description: text("description"),
    paramsJson: json("paramsJson").notNull(),
    returnType: varchar("returnType", { length: 160 }),
    artifactRef: varchar("artifactRef", { length: 255 }),
    status: mysqlEnum("status", ["draft", "approved", "disabled"]).default("draft").notNull(),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("data_udf_project_name_unique").on(table.projectId, table.name), index("data_udf_project_updated_idx").on(table.projectId, table.updatedAt)]
);

/** Project-owned taxonomy and plugin metadata are kept separate from workflow definitions. */
export const dataTags = mysqlTable(
  "data_tag",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    name: varchar("name", { length: 80 }).notNull(),
    color: varchar("color", { length: 16 }).default("#2d6bea").notNull(),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("data_tag_project_name_unique").on(table.projectId, table.name)]
);

export const projectPlugins = mysqlTable(
  "project_plugin",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    name: varchar("name", { length: 160 }).notNull(),
    pluginType: mysqlEnum("pluginType", ["transform", "connector", "visualization"]).notNull(),
    version: varchar("version", { length: 64 }).notNull(),
    configJson: json("configJson").notNull(),
    status: mysqlEnum("status", ["enabled", "disabled"]).default("enabled").notNull(),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("project_plugin_project_name_unique").on(table.projectId, table.name), index("project_plugin_project_updated_idx").on(table.projectId, table.updatedAt)]
);

/** Immutable, project-scoped dataflow run audit separate from general workflow runs. */
export const dataflowRuns = mysqlTable(
  "dataflow_run",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    triggerType: mysqlEnum("triggerType", ["manual", "schedule"]).default("manual").notNull(),
    /** Trusted task UID plus UTC minute bucket; null for manual runs. */
    scheduleBucket: varchar("scheduleBucket", { length: 96 }),
    status: mysqlEnum("status", ["queued", "running", "success", "failed", "cancelled"]).default("queued").notNull(),
    definitionSnapshotJson: json("definitionSnapshotJson").notNull(),
    inputJson: json("inputJson").notNull(),
    outputJson: json("outputJson"),
    errorJson: json("errorJson"),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    durationMs: int("durationMs"),
    triggeredByUserId: int("triggeredByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("dataflow_run_project_created_idx").on(table.projectId, table.createdAt), index("dataflow_run_workflow_created_idx").on(table.workflowId, table.createdAt), unique("dataflow_run_schedule_bucket_unique").on(table.workflowId, table.scheduleBucket)]
);

/** One hosted schedule per dataflow; task UID is the only trusted callback lookup key. */
export const dataflowSchedules = mysqlTable(
  "dataflow_schedule",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => flowProjects.id),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    cronExpression: varchar("cronExpression", { length: 96 }).notNull(),
    status: mysqlEnum("status", ["active", "paused", "deleted"]).default("paused").notNull(),
    scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
    lastTriggeredAt: timestamp("lastTriggeredAt"),
    lastRunId: varchar("lastRunId", { length: 36 }).references(() => dataflowRuns.id),
    createdByUserId: int("createdByUserId")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [unique("dataflow_schedule_workflow_unique").on(table.workflowId), unique("dataflow_schedule_task_uid_unique").on(table.scheduleCronTaskUid), index("dataflow_schedule_project_status_idx").on(table.projectId, table.status)]
);

/** Immutable definition snapshots created on every edit, publish, and rollback. */
export const workflowVersions = mysqlTable(
  "workflow_version",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    version: int("version").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: mysqlEnum("status", ["draft", "published"]).notNull(),
    definitionJson: json("definitionJson").notNull(),
    changeSource: mysqlEnum("changeSource", ["created", "updated", "published", "unpublished", "rolled_back"]).notNull(),
    restoredFromVersion: int("restoredFromVersion"),
    createdByUserId: int("createdByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [unique("workflow_version_workflow_version_unique").on(table.workflowId, table.version), index("workflow_version_workflow_created_idx").on(table.workflowId, table.createdAt)]
);

/** Per-recipient failed-run notifications; access never depends on another tenant's records. */
export const workflowRunAlerts = mysqlTable(
  "workflow_run_alert",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workflowId: varchar("workflowId", { length: 36 })
      .notNull()
      .references(() => workflows.id),
    runId: varchar("runId", { length: 36 })
      .notNull()
      .references(() => workflowRuns.id),
    recipientUserId: int("recipientUserId")
      .notNull()
      .references(() => users.id),
    severity: mysqlEnum("severity", ["warning", "critical"]).default("critical").notNull(),
    summary: varchar("summary", { length: 320 }).notNull(),
    detailsJson: json("detailsJson"),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("workflow_run_alert_recipient_idx").on(table.recipientUserId, table.readAt, table.createdAt), index("workflow_run_alert_workflow_idx").on(table.workflowId, table.createdAt)]
);

/** Private, user-owned node templates that can be inserted into any authorized workflow. */
export const workflowNodeTemplates = mysqlTable(
  "workflow_node_template",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 500 }),
    nodeType: varchar("nodeType", { length: 48 }).notNull(),
    configJson: json("configJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("workflow_node_template_owner_updated_idx").on(table.ownerUserId, table.updatedAt)]
);

/** Private, user-owned executable definitions referenced by subflow nodes. */
export const workflowSubflows = mysqlTable(
  "workflow_subflow",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 500 }),
    definitionJson: json("definitionJson").notNull(),
    isEnabled: boolean("isEnabled").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("workflow_subflow_owner_updated_idx").on(table.ownerUserId, table.updatedAt)]
);

export const authorizationAuditLogs = mysqlTable("authorization_audit_log", {
  id: varchar("id", { length: 36 }).primaryKey(),
  actorUserId: int("actorUserId").references(() => users.id),
  targetUserId: int("targetUserId").references(() => users.id),
  action: mysqlEnum("action", ["login_success", "login_failed", "logout", "user_created", "user_updated", "user_disabled", "role_assigned", "role_revoked", "temporary_role_assigned", "temporary_role_revoked"]).notNull(),
  resourceType: varchar("resourceType", { length: 64 }),
  resourceId: varchar("resourceId", { length: 64 }),
  detailsJson: json("detailsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
