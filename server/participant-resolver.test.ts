import { describe, expect, it } from "vitest";
import { PARTICIPANT_RESOLVER_MODES } from "./organization-service";
import {
  validateNodeConfig,
  withNodeConfigDefaults,
} from "../shared/workflow-node-contract";

describe("ParticipantResolver registry", () => {
  it("registers user, role, department, manager and form selectors", () => {
    expect(PARTICIPANT_RESOLVER_MODES).toEqual(
      expect.arrayContaining([
        "user",
        "role",
        "department",
        "department_manager",
        "initiator_manager_n",
        "sender_manager_n",
        "form_user",
      ])
    );
  });

  it("validates department and form-user selector configuration", () => {
    expect(() =>
      validateNodeConfig(
        "operate",
        withNodeConfigDefaults("operate", {
          nodeDh: "DEPARTMENT_REVIEW",
          instruction: "部门审核",
          assigneeMode: "department",
          assigneeUnitIds: ["unit-a"],
        })
      )
    ).not.toThrow();
    expect(() =>
      validateNodeConfig(
        "operate",
        withNodeConfigDefaults("operate", {
          nodeDh: "FORM_REVIEW",
          instruction: "表单指定人审核",
          assigneeMode: "form_user",
          assigneeFormField: "input.approverUserId",
        })
      )
    ).not.toThrow();
  });

  it("validates versioned task forms and SLA ordering", () => {
    expect(() =>
      validateNodeConfig(
        "operate",
        withNodeConfigDefaults("operate", {
          nodeDh: "SLA_REVIEW",
          instruction: "限时审核",
          assigneeMode: "initiator",
          formSchemaVersion: 2,
          formSchema: { fields: [{ key: "reason", type: "textarea" }] },
          dueAfterSeconds: 7200,
          reminderAfterSeconds: 3600,
          escalationAfterSeconds: 5400,
        })
      )
    ).not.toThrow();
    expect(() =>
      validateNodeConfig(
        "operate",
        withNodeConfigDefaults("operate", {
          nodeDh: "INVALID_SLA",
          instruction: "错误 SLA",
          assigneeMode: "initiator",
          dueAfterSeconds: 3600,
          reminderAfterSeconds: 7200,
        })
      )
    ).toThrow("提醒时间不能晚于办理时限");
  });
});
