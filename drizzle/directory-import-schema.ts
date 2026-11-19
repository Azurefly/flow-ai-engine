import {
  index,
  int,
  json,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const directoryImportBatches = mysqlTable(
  "directory_import_batch",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerUserId: int("ownerUserId").notNull(),
    filename: varchar("filename", { length: 160 }).notNull(),
    rowsJson: json("rowsJson").notNull(),
    createdAt: timestamp("createdAt", { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { fsp: 3 }).defaultNow().notNull(),
  },
  table => [
    index("directory_import_owner_time").on(table.ownerUserId, table.createdAt),
  ]
);
