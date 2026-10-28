import { expect, it } from "vitest";
import { normalizeRoleAuditEvent, auditDateBounds } from "./role-audit-event";
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

it("calendar-day filters include the whole end date using an exclusive next midnight", () => {
  const result = auditDateBounds("2026-03-08", "2026-03-08");
  expect(new Date(result.from!).getHours()).toBe(0);
  expect(new Date(result.until!).getDate()).toBe(9);
  expect(new Date(result.until!).getHours()).toBe(0);
  expect(auditDateBounds("", "")).toEqual({ from: undefined, until: undefined });
});
it.each([["2026-02-30", ""], ["bad", ""], ["2026-10-30", "2026-10-01"]])("rejects invalid or inverted calendar bounds %s %s", (from, to) => {
  expect(auditDateBounds(from, to).error).toBeTruthy();
});
