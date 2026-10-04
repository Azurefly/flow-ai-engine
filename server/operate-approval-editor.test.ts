import { expect, it } from "vitest";
import {
  updateOperateApproval,
  orderOperateApprovers,
} from "../shared/operate-approval-editor";
import { normalizeReferenceOperateConfig } from "../shared/reference-operate-config";
it("编辑审批方式同步原版属性与画布配置，保留绑定和扩展字段", () => {
  const config = {
    bdcz: { bdcz: ["op"], custom: "keep" },
    operateAttributeMap: {
      bindRole: ["acceptor"],
      custom: 1,
      signForFlag: "andSignFor",
      andSignForAttribute: {
        andSignForStaff: [7, 2],
        custom: 9,
        passPercent: 0.66,
      },
    },
  };
  const updates = updateOperateApproval(config, {
    mode: "sequentialSignFor",
    userIds: ["2", "7", "2"],
  });
  const result = normalizeReferenceOperateConfig({ ...config, ...updates });
  expect(result).toMatchObject({
    signMode: "sequentialSignFor",
    signSelectorUserIds: [2, 7],
    passPercent: 0.66,
    bindRoles: ["acceptor"],
    bindOperateCodes: ["op"],
  });
  expect(updates.bdcz).toMatchObject({ custom: "keep" });
  expect(updates.operateAttributeMap).toMatchObject({
    custom: 1,
    andSignForAttribute: { custom: 9 },
  });
  expect(config.operateAttributeMap.signForFlag).toBe("andSignFor");
});
it("画布百分比 1 表示百分之一，兼容原版小数比例", () => {
  expect(
    normalizeReferenceOperateConfig({
      bdcz: { hqhqsz: "andSignFor", hqtgbfb: 1 },
    }).passPercent
  ).toBe(0.01);
  const config = updateOperateApproval({}, { mode: "andSignFor", percent: 1 });
  expect(normalizeReferenceOperateConfig(config).passPercent).toBe(0.01);
  expect(
    normalizeReferenceOperateConfig(
      updateOperateApproval(config, { percent: 66 })
    ).passPercent
  ).toBe(0.66);
});
it("单人模式覆盖导入审批方式，清空名单不会沿用旧人员", () => {
  const config = {
    operateAttributeMap: {
      signForFlag: "andSignFor",
      andSignForAttribute: { andSignForStaff: [2, 3] },
    },
  };
  expect(
    normalizeReferenceOperateConfig({
      ...config,
      ...updateOperateApproval(config, { mode: "single", userIds: [] }),
    })
  ).toMatchObject({ signMode: "single", signSelectorUserIds: [] });
});
it("顺序会签遵守配置人员顺序，同时排除无资格人员", () => {
  expect(orderOperateApprovers([2, 7, 9], [9, 2, 99, 7], true)).toEqual([
    9, 2, 7,
  ]);
  expect(orderOperateApprovers([2, 7, 9], [], true)).toEqual([2, 7, 9]);
  expect(orderOperateApprovers([2, 7, 9], [9, 2], false)).toEqual([2, 9]);
});
