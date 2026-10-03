import { describe, expect, it } from "vitest";
import { operateParticipantFields } from "../shared/operate-participant-fields";
import {
  FLOW_NODE_DEFINITIONS,
  createDefaultNodeConfig,
  validateNodeConfig,
} from "../shared/workflow-node-contract";

const fields = FLOW_NODE_DEFINITIONS.operate.fields;
const visible = (mode: string) =>
  operateParticipantFields(fields, { assigneeMode: mode }).map(
    field => field.key
  );
describe("人工操作处理人配置", () => {
  it("只显示当前人员解析方式需要的参数", () => {
    expect(visible("user")).toContain("assigneeUserId");
    expect(visible("user")).not.toContain("assigneeRoleCode");
    expect(visible("role")).toContain("assigneeRoleCode");
    expect(visible("initiator")).not.toContain("assigneeUserId");
    expect(visible("department_manager")).toContain("assigneeUnitIds");
    expect(visible("department_manager")).not.toContain("includeDescendants");
    expect(visible("department")).toContain("includeDescendants");
    expect(visible("sender_manager_n")).toContain("managerLevel");
    expect(visible("form_user")).toContain("assigneeFormField");
    expect(visible("user")).toContain("outcomes");
  });
  it("切换方式保留历史配置，但明确标记当前用户参数必填", () => {
    const config = {
      assigneeMode: "user",
      assigneeUserId: 3,
      assigneeRoleCode: "reviewer",
    };
    expect(
      operateParticipantFields(fields, config).find(
        field => field.key === "assigneeUserId"
      )?.required
    ).toBe(true);
    expect(
      operateParticipantFields(fields, {
        ...config,
        assigneeMode: "role",
      }).find(field => field.key === "assigneeRoleCode")?.required
    ).toBe(true);
    expect(config.assigneeUserId).toBe(3);
    expect(
      fields.find(field => field.key === "assigneeUserId")?.required
    ).toBeUndefined();
  });
  it("缺少指定用户不能发布，默认部门范围与运行时一致", () => {
    const config = {
      ...createDefaultNodeConfig("operate"),
      nodeDh: "APPROVE",
      assigneeMode: "user",
    };
    for (const assigneeUserId of [undefined, null, "", 0, 1.5])
      expect(() =>
        validateNodeConfig("operate", { ...config, assigneeUserId })
      ).toThrow();
    expect(() =>
      validateNodeConfig("operate", { ...config, assigneeUserId: 3 })
    ).not.toThrow();
    expect(createDefaultNodeConfig("operate").includeDescendants).toBe(true);
    expect(createDefaultNodeConfig("operate").assigneeUnitIds).toEqual([]);
    for (const assigneeUnitIds of [[""], [{}], [3]])
      expect(() =>
        validateNodeConfig("operate", {
          ...config,
          assigneeMode: "department_manager",
          assigneeUnitIds,
        })
      ).toThrow("部门 ID");
  });
});
