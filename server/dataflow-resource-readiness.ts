import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import {
  dataAssetReadiness,
  dataSourceReadiness,
  isMysqlIdentifier,
} from "../shared/data-source-capabilities";
import { builtinDataFunctionChoice } from "../shared/builtin-data-functions";
import type {
  WorkflowDefinition,
  WorkflowCompileDiagnostic,
} from "./workflow-compiler";

export class DataflowResourceReadinessError extends TRPCError {
  constructor(readonly diagnostics: WorkflowCompileDiagnostic[]) {
    super({
      code: "BAD_REQUEST",
      message: diagnostics[0]?.message ?? "数据流程引用的资源暂不可执行。",
    });
  }
}

type Reader = Pick<mysql.Pool, "query">;
const parse = (value: unknown) => {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

/** Metadata preflight only: never probes a network or reads external data. */
export async function dataflowResourceDiagnostics(
  reader: Reader,
  projectId: string,
  definition: WorkflowDefinition,
  lock = false
): Promise<WorkflowCompileDiagnostic[]> {
  const assets = definition.nodes.filter(node =>
    ["source", "table"].includes(node.type)
  );
  const sql = definition.nodes.filter(node =>
    ["sql", "edit_sql"].includes(node.type)
  );
  const functions = definition.nodes.filter(node => node.type === "udf");
  const unique = (nodes: typeof assets, key: string) =>
    Array.from(
      new Set(nodes.map(node => String(node.config[key] ?? "").trim()))
    )
      .filter(Boolean)
      .sort();
  const assetIds = unique(assets, "assetId"),
    sourceIds = unique(sql, "datasourceId"),
    functionIds = unique(functions, "udfId");
  const suffix = lock ? " FOR SHARE" : "";
  const assetRows = assetIds.length
    ? (
        await reader.query<mysql.RowDataPacket[]>(
          "SELECT a.id,a.name,a.sourceId,a.status,s.id AS matchedSourceId,s.sourceType,s.status AS sourceStatus,s.connectionJson FROM data_asset a LEFT JOIN data_source s ON s.id=a.sourceId AND s.projectId=a.projectId WHERE a.projectId=? AND a.id IN (?) ORDER BY a.id" +
            suffix,
          [projectId, assetIds]
        )
      )[0]
    : [];
  const sourceRows = sourceIds.length
    ? (
        await reader.query<mysql.RowDataPacket[]>(
          "SELECT id,sourceType,status,connectionJson FROM data_source WHERE projectId=? AND id IN (?) ORDER BY id" +
            suffix,
          [projectId, sourceIds]
        )
      )[0]
    : [];
  const functionRows = functionIds.length
    ? (
        await reader.query<mysql.RowDataPacket[]>(
          "SELECT id,name,status,udfType,artifactRef FROM data_udf WHERE projectId=? AND id IN (?) ORDER BY id" +
            suffix,
          [projectId, functionIds]
        )
      )[0]
    : [];
  const diagnostics: WorkflowCompileDiagnostic[] = [];
  const add = (node: (typeof assets)[number], field: string, message: string) =>
    diagnostics.push({
      code: "DATAFLOW_RESOURCE_UNAVAILABLE",
      message: `节点“${node.name}”：${message}`,
      location: { kind: "node", nodeId: node.id, field },
    });
  for (const node of assets) {
    const asset = assetRows.find(
      row => String(row.id) === String(node.config.assetId ?? "").trim()
    );
    if (!asset) {
      add(node, "assetId", "数据资源不存在、已移出当前业务或尚未选择。");
      continue;
    }
    const readiness = dataAssetReadiness(
      { name: asset.name, sourceId: asset.sourceId, status: asset.status },
      asset.matchedSourceId
        ? {
            sourceType: asset.sourceType,
            status: asset.sourceStatus,
            connection: parse(asset.connectionJson),
          }
        : undefined
    );
    if (!readiness.ready) add(node, "assetId", readiness.message);
    else if (
      readiness.mode === "mysql" &&
      Array.isArray(node.config.columns) &&
      node.config.columns.some(column => !isMysqlIdentifier(String(column)))
    )
      add(node, "columns", "MySQL读取列名必须是安全标识符，请重新选择字段。");
  }
  for (const node of sql) {
    const source = sourceRows.find(
      row => String(row.id) === String(node.config.datasourceId ?? "").trim()
    );
    if (!source) {
      add(node, "datasourceId", "SQL数据源不存在、已移出当前业务或尚未选择。");
      continue;
    }
    const readiness = dataSourceReadiness({
      ...source,
      connection: parse(source.connectionJson),
    });
    if (!readiness.ready || readiness.mode !== "mysql")
      add(
        node,
        "datasourceId",
        readiness.ready
          ? "SQL节点仅支持已通过连接测试的MySQL数据源。"
          : readiness.message
      );
  }
  for (const node of functions) {
    const row = functionRows.find(
      row => String(row.id) === String(node.config.udfId ?? "").trim()
    );
    if (!row || row.status !== "approved") {
      add(node, "udfId", "函数不存在、未通过审核或不属于当前业务。");
      continue;
    }
    if (
      builtinDataFunctionChoice({
        id: String(row.id),
        name: String(row.name),
        udfType: String(row.udfType),
        artifactRef: row.artifactRef,
      }).disabled
    )
      add(
        node,
        "udfId",
        "该函数仅登记了说明，尚未绑定当前可执行的内置处理实现。"
      );
  }
  return diagnostics;
}

export async function assertDataflowResourcesReady(
  reader: Reader,
  projectId: string,
  definition: WorkflowDefinition,
  lock = false
) {
  const diagnostics = await dataflowResourceDiagnostics(
    reader,
    projectId,
    definition,
    lock
  );
  if (diagnostics.length) throw new DataflowResourceReadinessError(diagnostics);
}
