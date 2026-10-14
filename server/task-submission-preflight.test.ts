import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateWorkflowTaskSubmission } from "./workflow-engine";

const task = { payload: { config: { formSchema: { fields: [
  { key: "amount", type: "number", required: true, min: 10 },
  { key: "fixed", type: "text", required: true, readOnly: true, defaultValue: "原值" },
] } } } };
it("领取之前校验必填、界限和只读提交，并补齐合法默认值", () => {
  expect(() => validateWorkflowTaskSubmission(task, { decision: "approved" })).toThrow("必填");
  expect(() => validateWorkflowTaskSubmission(task, { decision: "approved", amount: 1 })).toThrow("低于最小值");
  expect(() => validateWorkflowTaskSubmission(task, { decision: "approved", amount: 20, fixed: "改写" })).toThrow("只读");
  expect(validateWorkflowTaskSubmission(task, { decision: "approved", amount: 20 })).toMatchObject({ fixed: "原值", amount: 20, outcome: "approved" });
});
it("领取之前也校验审批意见和实际结果分支", () => {
  expect(() => validateWorkflowTaskSubmission(task, { decision: "rejected", amount: 20 })).toThrow("处理意见");
  expect(() => validateWorkflowTaskSubmission({ ...task, outcomeHandlesJson: { mode: "explicit", handles: { approved: "yes" } } }, { decision: "approved", outcome: "missing", amount: 20 })).toThrow("运行分支");
  const source = readFileSync(new URL("./p1-service.ts", import.meta.url), "utf8").split("export async function executeWorkflowTask(")[1].split("export async function completeWorkflowTask(")[0];
  expect(source.indexOf("validateWorkflowTaskSubmission(task, result)")).toBeLessThan(source.indexOf("await claimWorkflowTask(user, taskId)"));
});
