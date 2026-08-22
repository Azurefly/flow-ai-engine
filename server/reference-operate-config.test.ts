import { describe, expect, it } from "vitest";
import { approvalRequirement, normalizeReferenceOperateConfig } from "../shared/reference-operate-config";

describe("original operate-node runtime compatibility", () => {
  it("maps the original canvas fields to the formal server contract", () => {
    const normalized = normalizeReferenceOperateConfig({
      bddxcrjsrsx: true,
      bdczcrjsrsx: true,
      bdcz: {
        bdcz: [{ id: "APPROVE", text: "审核通过" }],
        bdczjs: ["acceptor"],
        hqhqsz: "andSignFor",
        xzdfhq: { userWords: [{ key: "12", text: "审批人" }] },
        hqtgbfb: 75,
      },
      sxsz: { zdglxgfsz: ["unitWord", "upperAuthUnitWord"], yrdbmsfkcz: "是", xzdzlcjywc: [{ id: "child-1", text: "子流程" }] },
      fsfsz: { fsfbm: "申请人", fsflzsf: "以本人身份", fsfgycz: "撤回", lsjspz: [{ pzlx: "赋予", xzjs: { id: "employee", text: "员工" } }] },
      jsfsz: { jsfbm: "审批人", jsfgycz: "移交", lsjspz: [{ pzlx: "移除", xzjs: { id: "observer", text: "观察员" } }] },
      zdzx: { sfzdzx: "是", tjsz: [{ left: "{{input.days}}", operator: "lessThan", right: 3 }], code: [] },
    });

    expect(normalized).toMatchObject({
      bindOperateCodes: ["APPROVE"], bindRoles: ["acceptor"], signMode: "andSignFor", signSelectorUserIds: [12], passPercent: 0.75,
      autoRelatedParty: ["unitWord", "upperAuthUnitWord"], relatedUnitOperate: true, requiredSubflowIds: ["child-1"],
      bindObjectReceiverEffective: true, bindOperateReceiverEffective: true, senderIdentity: "UserWord", senderAlias: "申请人", receiverAlias: "审批人",
      senderInnateOperation: "撤回", receiverInnateOperation: "移交", senderTemporaryRoles: [{ action: "add", roleKeys: ["employee"] }],
      receiverTemporaryRoles: [{ action: "remove", roleKeys: ["observer"] }], autoExecute: true, hasUnsafeAutoExecuteCode: false,
    });
  });

  it("also accepts the original server persistence shape", () => {
    const normalized = normalizeReferenceOperateConfig({
      operateAttributeMap: {
        bindOperate: [{ flowOprateCode: "PASS", flowOprateName: "通过" }], bindRole: ["sender"], signForFlag: "orSignFor",
        orSignForAttribute: { orSignForStaff: { userIds: [3, 4] } }, autoRelatedParty: ["authUnitWord"], relatedUnitOperate: true,
        bindChildWorkModuleIdList: ["child-a"], bindObjectReceiverEffective: true,
      },
      senderSettings: { senderIdentity: "AuthUnitWord", temPoraryRoleConfig: { configTypeList: [{ addOrRemoveFlag: false, roleId: "old-role" }] } },
      autoExecute: false,
    });
    expect(normalized).toMatchObject({ bindOperateCodes: ["PASS"], bindRoles: ["sender"], signMode: "orSignFor", signSelectorUserIds: [3, 4], senderIdentity: "AuthUnitWord" });
    expect(normalized.senderTemporaryRoles).toEqual([{ action: "remove", roleKeys: ["old-role"] }]);
  });

  it("calculates original or-sign and percentage based counters", () => {
    expect(approvalRequirement("orSignFor", 4, 1)).toBe(1);
    expect(approvalRequirement("andSignFor", 4, 0.75)).toBe(3);
    expect(approvalRequirement("andSignFor", 3, 1)).toBe(3);
  });
});
