import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSharedPool } from "./db";
import { getProjectAccess, type ProjectUser } from "./project-service";
import {
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from "./workflow-compiler";
import { dataflowResourceDiagnostics } from "./dataflow-resource-readiness";
import type { FlowType } from "../shared/workflow-node-contract";

const schema = z.object({
  name: z.string().trim().min(1).max(160).default("导入流程"),
  description: z.string().trim().max(1200).nullish(),
  processCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_-]{1,63}$/)
    .nullish(),
  flowType: z.enum(["state", "control", "data"]).default("state"),
  definition: z.unknown(),
});
export type WarehouseImportItem = {
  index: number;
  name: string;
  flowType: FlowType | null;
  processCode?: string;
  description?: string;
  definition: WorkflowDefinition | null;
  errors: string[];
  warnings: string[];
};

/** Pure structural preflight. Every item is examined before the first creation request. */
export function inspectWarehouseImport(
  payload: unknown,
  preserveCodes = false
): WarehouseImportItem[] {
  if (Buffer.byteLength(JSON.stringify(payload ?? null), "utf8") > 1024 * 1024)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "导入文件不得超过1 MiB。",
    });
  const value = payload as any;
  const rows = Array.isArray(value?.workflows)
    ? value.workflows
    : [value?.workflow ?? value];
  if (!rows.length || rows.length > 100)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "每次请选择1–100个流程。",
    });
  const items: WarehouseImportItem[] = rows.map(
    (raw: any, index: number): WarehouseImportItem => {
      const candidate = raw?.workflow ?? raw;
      const result = schema.safeParse({
        ...candidate,
        processCode: preserveCodes ? candidate?.processCode : undefined,
      });
      const item: WarehouseImportItem = {
        index,
        name:
          typeof candidate?.name === "string"
            ? candidate.name.slice(0, 160)
            : `第${index + 1}个流程`,
        flowType: null,
        definition: null,
        errors: [],
        warnings: [],
      };
      if (!result.success) {
        const messages: Record<string, string> = {
          name: "流程名称不能为空，且不得超过160字。",
          description: "流程说明不得超过1200字。",
          flowType: "流程类型须为 state、control 或 data。",
          processCode:
            "流程代号须为2–64位字母、数字、下划线或连字符，并以字母开头。",
        };
        item.errors = result.error.issues.map(
          issue =>
            messages[String(issue.path[0])] ||
            "流程字段格式无效，请检查导入文件。"
        );
        return item;
      }
      Object.assign(item, {
        name: result.data.name,
        flowType: result.data.flowType,
        description: result.data.description || undefined,
        processCode: result.data.processCode?.toUpperCase(),
      });
      try {
        const definition = result.data.definition as any;
        if (
          !Array.isArray(definition?.nodes) ||
          !Array.isArray(definition?.edges)
        )
          throw Error("导入文件缺少流程定义的节点或连线。");
        item.definition = validateWorkflowDefinition(definition, {
          flowType: result.data.flowType,
          executable: false,
        });
      } catch (error) {
        item.errors.push(
          error instanceof Error ? error.message : "流程结构无效。"
        );
      }
      return item;
    }
  );
  for (const item of items)
    if (
      item.processCode &&
      items.some(
        other =>
          other.index !== item.index && other.processCode === item.processCode
      )
    )
      item.errors.push("文件内流程代号重复，请取消保留原代号或修正文件。");
  return items;
}

/** Read-only metadata check: never executes a node, probes a connection, or creates a draft. */
export async function previewWarehouseImport(
  user: ProjectUser,
  input: { projectId: string; payload: unknown; preserveCodes?: boolean }
) {
  const access = await getProjectAccess(user, input.projectId);
  if (!access.exists || !access.permissions.has("project:workflow:create"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前账号无权向此业务导入流程。",
    });
  const items = inspectWarehouseImport(input.payload, input.preserveCodes);
  const codes = items
    .map(item => item.processCode)
    .filter((code): code is string => Boolean(code));
  const [existing] = codes.length
    ? await getSharedPool().query<any[]>(
        "SELECT processCode FROM workflow WHERE projectId=? AND processCode IN (?)",
        [input.projectId, codes]
      )
    : [[]];
  for (const item of items) {
    if (
      item.processCode &&
      existing.some(row => row.processCode === item.processCode)
    )
      item.errors.push(
        "目标业务已占用此流程代号（含归档流程），请取消保留原代号。"
      );
    if (item.definition && !item.errors.length && item.flowType === "data")
      item.warnings = (
        await dataflowResourceDiagnostics(
          getSharedPool(),
          input.projectId,
          item.definition
        )
      ).map(diagnostic => diagnostic.message);
  }
  return { items, canImport: items.every(item => !item.errors.length) };
}
