import {
  index,
  int,
  json,
  mediumtext,
  mysqlTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { dataAssets, dataflowRuns } from "./schema";

export const dataConnectorVersions = mysqlTable(
  "data_connector_version",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 }).notNull(),
    assetId: varchar("assetId", { length: 36 })
      .notNull()
      .references(() => dataAssets.id),
    sourceId: varchar("sourceId", { length: 36 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    contractJson: json("contractJson").notNull(),
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    fileBase64: mediumtext("fileBase64"),
    byteCount: int("byteCount").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("connector_version_asset").on(
      table.projectId,
      table.assetId,
      table.createdAt
    ),
  ]
);

export const dataConnectorPages = mysqlTable(
  "data_connector_page",
  {
    runId: varchar("runId", { length: 36 })
      .notNull()
      .references(() => dataflowRuns.id, { onDelete: "cascade" }),
    nodeId: varchar("nodeId", { length: 128 }).notNull(),
    pageNo: int("pageNo").notNull(),
    versionId: varchar("versionId", { length: 64 })
      .notNull()
      .references(() => dataConnectorVersions.id),
    cursorIn: varchar("cursorIn", { length: 256 }),
    cursorOut: varchar("cursorOut", { length: 256 }),
    rowsJson: json("rowsJson").notNull(),
    byteCount: int("byteCount").notNull(),
    digest: varchar("digest", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [primaryKey({ columns: [table.runId, table.nodeId, table.pageNo] })]
);

export const dataConnectorWrites = mysqlTable(
  "data_connector_write",
  {
    operationKey: varchar("operationKey", { length: 64 }).primaryKey(),
    projectId: varchar("projectId", { length: 36 }).notNull(),
    runId: varchar("runId", { length: 36 })
      .notNull()
      .references(() => dataflowRuns.id, { onDelete: "cascade" }),
    nodeId: varchar("nodeId", { length: 128 }).notNull(),
    versionId: varchar("versionId", { length: 64 })
      .notNull()
      .references(() => dataConnectorVersions.id),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    rowsJson: json("rowsJson").notNull(),
    rowCount: int("rowCount").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    confirmedBy: int("confirmedBy"),
    receipt: varchar("receipt", { length: 160 }),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("connector_writes_run").on(table.projectId, table.runId)]
);
