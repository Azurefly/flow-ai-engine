import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { workflowRuns, workflowWaitSubscriptions } from "./schema";

export const workflowRunLinks = mysqlTable(
  "workflow_run_link",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    parentRunId: varchar("parentRunId", { length: 36 })
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    childRunId: varchar("childRunId", { length: 36 })
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    waitId: varchar("waitId", { length: 36 })
      .notNull()
      .references(() => workflowWaitSubscriptions.id, { onDelete: "cascade" }),
    nodeId: varchar("nodeId", { length: 160 }).notNull(),
    executionKey: varchar("executionKey", { length: 160 }).notNull(),
    callOrdinal: int("callOrdinal").notNull().default(1),
    childVersion: int("childVersion").notNull(),
    planHash: varchar("planHash", { length: 64 }).notNull(),
    failurePolicy: mysqlEnum("failurePolicy", [
      "fail_parent",
      "return_result",
      "retry_once",
      "manual",
    ]).notNull(),
    cancelPolicy: mysqlEnum("cancelPolicy", ["propagate", "detach"]).notNull(),
    state: mysqlEnum("state", [
      "waiting",
      "resumed",
      "failed",
      "retrying",
      "manual",
      "detached",
      "cancelled",
    ])
      .notNull()
      .default("waiting"),
    decisionByUserId: int("decisionByUserId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    settledAt: timestamp("settledAt"),
  },
  table => [
    uniqueIndex("workflow_link_visit_call").on(
      table.parentRunId,
      table.nodeId,
      table.executionKey,
      table.callOrdinal
    ),
    uniqueIndex("workflow_link_child").on(table.childRunId),
    index("workflow_link_state").on(table.state, table.createdAt),
    index("workflow_link_wait").on(table.waitId),
  ]
);
