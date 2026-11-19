import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";
import { assistantSessions } from "./schema";

export const assistantTurnJobs = mysqlTable(
  "assistant_turn_job",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sessionId: varchar("sessionId", { length: 36 })
      .notNull()
      .references(() => assistantSessions.id, { onDelete: "cascade" }),
    requestId: varchar("requestId", { length: 100 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    payloadJson: json("payloadJson").notNull(),
    baseRevision: int("baseRevision").notNull(),
    actorTokenVersion: int("actorTokenVersion").notNull(),
    status: mysqlEnum("status", [
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
      "needs_review",
    ])
      .notNull()
      .default("queued"),
    failureCode: varchar("failureCode", { length: 40 }),
    reviewNote: varchar("reviewNote", { length: 320 }),
    reviewedBy: int("reviewedBy"),
    reviewedAt: timestamp("reviewedAt", { fsp: 3 }),
    attempts: int("attempts").notNull().default(0),
    leaseToken: varchar("leaseToken", { length: 36 }),
    leaseUntil: timestamp("leaseUntil", { fsp: 3 }),
    createdAt: timestamp("createdAt", { fsp: 3 }).notNull().defaultNow(),
    startedAt: timestamp("startedAt", { fsp: 3 }),
    dispatchedAt: timestamp("dispatchedAt", { fsp: 3 }),
    actionName: varchar("actionName", { length: 100 }),
    actionKey: varchar("actionKey", { length: 36 }),
    finishedAt: timestamp("finishedAt", { fsp: 3 }),
  },
  table => [
    unique("assistant_job_request_unique").on(table.sessionId, table.requestId),
    index("assistant_job_session_revision").on(
      table.sessionId,
      table.baseRevision,
      table.status
    ),
    index("assistant_job_claim").on(
      table.status,
      table.leaseUntil,
      table.createdAt
    ),
  ]
);
