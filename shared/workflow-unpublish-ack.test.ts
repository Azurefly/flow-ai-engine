import { expect, it } from "vitest";
import { acknowledgeWorkflowUnpublish } from "./workflow-publish";
const definition = {
  nodes: [{ id: "start", config: { a: 1, b: 2 } }],
  edges: [],
};
const base = {
  workflowId: "flow",
  name: "订单审批",
  definitionVersion: 3,
  definitionJson: JSON.stringify(definition),
};
const submitted = { id: "flow", expectedDefinitionVersion: 3 };
const result = {
  id: "flow",
  name: base.name,
  definitionVersion: 4,
  status: "draft",
  definition,
};
it("只推进已确认的取消发布版本，基准定义不变且不改动本地编辑对象", () => {
  const local = { nodes: [{ id: "start", config: { a: 9, b: 2 } }], edges: [] };
  expect(acknowledgeWorkflowUnpublish(base, submitted, result)).toEqual({
    ...base,
    definitionVersion: 4,
  });
  expect(base.definitionVersion).toBe(3);
  expect(local.nodes[0].config.a).toBe(9);
});
it("服务端对象键顺序变化不造成无效冲突", () => {
  expect(
    acknowledgeWorkflowUnpublish(base, submitted, {
      ...result,
      definition: {
        edges: [],
        nodes: [{ config: { b: 2, a: 1 }, id: "start" }],
      },
    })?.definitionVersion
  ).toBe(4);
});
it.each([
  { id: "other" },
  { status: "published" },
  { definitionVersion: 5 },
  { name: "其他人改名" },
  { definition: { nodes: [], edges: [] } },
])("不同身份、版本或内容不能静默重定基准 %j", change => {
  expect(
    acknowledgeWorkflowUnpublish(base, submitted, { ...result, ...change })
  ).toBeNull();
});
it("旧确认、无基准与非法版本均保持原基准", () => {
  const acknowledged = { ...base, definitionVersion: 4 };
  expect(acknowledgeWorkflowUnpublish(acknowledged, submitted, result)).toBe(
    acknowledged
  );
  const newer = { ...base, definitionVersion: 5, name: "更新版本" };
  expect(acknowledgeWorkflowUnpublish(newer, submitted, result)).toBe(newer);
  expect(acknowledgeWorkflowUnpublish(null, submitted, result)).toBeNull();
  expect(
    acknowledgeWorkflowUnpublish(
      base,
      { ...submitted, expectedDefinitionVersion: NaN },
      result
    )
  ).toBeNull();
});
