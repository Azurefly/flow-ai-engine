import { expect, it } from "vitest";
import { normalizeRoleAuditEvent } from "./role-audit-event";
it.each(["project_archived", "project_restored"])("业务生命周期 %s 使用治理动作且保留原事件", operation => {
  const event = { action: "user_updated", resourceType: "flow_project", detailsJson: { operation } };
  expect(normalizeRoleAuditEvent(event)).toMatchObject({ action: operation, legacyAction: "user_updated" });
  expect(event.action).toBe("user_updated");
});
it.each(["created", "updated", "deleted"])(
  "历史角色 %s 记录归入角色操作且不改写原记录",
  kind => {
    const event = {
      id: "own",
      action: "user_updated",
      resourceType: "iam_role",
      detailsJson: JSON.stringify({ operation: `custom_role_${kind}` }),
    };
    expect(normalizeRoleAuditEvent(event)).toMatchObject({
      id: "own",
      action: `role_${kind}`,
      legacyAction: "user_updated",
    });
    expect(event.action).toBe("user_updated");
  }
);
it.each([null, "bad", { operation: "__proto__" }, { operation: "unknown" }])(
  "未知历史内容保留原事件 %s",
  detailsJson => {
    const event = {
      action: "user_updated",
      resourceType: "iam_role",
      detailsJson,
    };
    expect(normalizeRoleAuditEvent(event)).toBe(event);
  }
);
it("普通账号事件不被当作角色配置", () => {
  const event = {
    action: "user_updated",
    resourceType: "user",
    detailsJson: { operation: "custom_role_updated" },
  };
  expect(normalizeRoleAuditEvent(event)).toBe(event);
});
