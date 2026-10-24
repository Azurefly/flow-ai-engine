import type { WorkflowDefinition } from "../server/workflow-compiler";
import { readAggregateConfig } from "./dataflow-aggregate-config";
import { resolveDataflowJoinInputs } from "./dataflow-join-inputs";

export type DataflowConfigChange = {
  nodeId: string;
  nodeName: string;
  kind: "aggregate" | "join";
  details: string[];
};
export type DataflowConfigIssue = {
  nodeId: string;
  nodeName: string;
  message: string;
};
export type DataflowConfigConversion = {
  changes: DataflowConfigChange[];
  issues: DataflowConfigIssue[];
  candidate: WorkflowDefinition | null;
};
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const label = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "未配置");

/** Inspection only. An explicit editor action must apply the candidate as unsaved input. */
export function inspectDataflowConfigConversion(
  definition: WorkflowDefinition
): DataflowConfigConversion {
  const candidate = structuredClone(definition);
  const changes: DataflowConfigChange[] = [],
    issues: DataflowConfigIssue[] = [];
  const nodes = new Map(definition.nodes.map(node => [node.id, node]));
  for (const node of candidate.nodes) {
    const details: string[] = [];
    try {
      if (
        node.type === "aggregate" &&
        Array.isArray(node.config.metrics) &&
        node.config.metrics.some(
          item => record(item) && (own(item, "as") || own(item, "op"))
        )
      ) {
        const metrics = node.config.metrics.map((item, index) => {
          if (!record(item))
            throw new Error(`指标 ${index + 1} 不是对象，请手工核对。`);
          const next = { ...item };
          for (const [oldKey, newKey] of [
            ["as", "name"],
            ["op", "operation"],
          ]) {
            if (!own(item, oldKey)) continue;
            if (
              typeof item[oldKey] !== "string" ||
              !String(item[oldKey]).trim()
            )
              throw new Error(
                `指标 ${index + 1} 的 ${oldKey} 为空或不是文本，请手工核对。`
              );
            if (
              own(item, newKey) &&
              (typeof item[newKey] !== "string" ||
                String(item[newKey]).trim() !== String(item[oldKey]).trim())
            )
              throw new Error(
                `指标 ${index + 1} 的 ${oldKey} 与 ${newKey} 不一致，请先手工确认。`
              );
            next[newKey] = String(item[oldKey]).trim();
            delete next[oldKey];
            const display =
              newKey === "operation"
                ? ({
                    count: "计数",
                    sum: "求和",
                    min: "最小值",
                    max: "最大值",
                    avg: "平均值",
                  }[String(next[newKey])] ?? label(next[newKey]))
                : label(next[newKey]);
            details.push(
              `指标 ${index + 1}：${newKey === "operation" ? "计算方式" : "输出名称"}（${oldKey} → ${newKey}）将明确为“${display}”。`
            );
          }
          if ((own(item, "as") || own(item, "op")) && !own(next, "operation"))
            throw new Error(
              `指标 ${index + 1} 未明确计算方式，请手工确认，不能推测为计数。`
            );
          return next;
        });
        readAggregateConfig({ ...node.config, metrics });
        node.config = { ...node.config, metrics };
        changes.push({
          nodeId: node.id,
          nodeName: node.name,
          kind: "aggregate",
          details,
        });
      } else if (node.type === "join") {
        const parents = definition.edges
          .filter(edge => edge.targetNodeId === node.id)
          .map(edge => edge.sourceNodeId);
        if (parents.some(id => !nodes.has(id)))
          throw new Error("关联输入指向不存在的节点，请先修正连线。");
        const left = String(node.config.leftInputNodeId ?? "").trim(),
          right = String(node.config.rightInputNodeId ?? "").trim();
        if (!left && !right) {
          const [leftId, rightId] = resolveDataflowJoinInputs(
            node.config,
            parents,
            true
          );
          node.config = {
            ...node.config,
            leftInputNodeId: leftId,
            rightInputNodeId: rightId,
          };
          changes.push({
            nodeId: node.id,
            nodeName: node.name,
            kind: "join",
            details: [
              `左侧输入：${nodes.get(leftId)!.name}（${leftId}）。`,
              `右侧输入：${nodes.get(rightId)!.name}（${rightId}）。`,
              "建议依据当前画布的入边顺序；请核对它与预期左右数据源一致。",
            ],
          });
        } else resolveDataflowJoinInputs(node.config, parents);
      }
    } catch (error) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        message:
          error instanceof Error
            ? error.message
            : "配置无法自动转换，请手工核对。",
      });
    }
  }
  return {
    changes,
    issues,
    candidate: issues.length || !changes.length ? null : candidate,
  };
}
