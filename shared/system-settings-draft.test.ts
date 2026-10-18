import { expect, it } from "vitest";
import {
  createSettingsDraft,
  settingChangeLabel,
  settingsDraftDiff,
  settingsDraftFields,
  settingsDraftPayload,
} from "./system-settings-draft";
it("两类草稿各自记录基线，更新表单不改写保存前内容", () => {
  const general = createSettingsDraft(
    "general",
    { platformName: "Original" },
    "token-1"
  );
  const changed = {
    ...general,
    form: { ...general.form, platformName: "Draft" },
  };
  expect(settingsDraftDiff(general)).toEqual([]);
  expect(settingsDraftDiff(changed)).toEqual([
    {
      field: "platformName",
      label: "平台名称",
      before: "Original",
      after: "Draft",
    },
  ]);
  expect(changed.base.platformName).toBe("Original");
  const approval = createSettingsDraft(
    "approval",
    { requireProjectApproval: false },
    "token-2"
  );
  expect(settingsDraftDiff(approval)).toEqual([]);
  expect(approval.token).toBe("token-2");
  expect(Object.keys(settingsDraftFields(approval)).sort()).toEqual([
    "requireProjectApproval",
    "reviewerMode",
  ]);
});
it("改回基线后不再算修改，审批草稿不携带通用字段", () => {
  const draft = createSettingsDraft(
    "approval",
    { requireProjectApproval: true, reviewerMode: "independent_reviewer" },
    "token"
  );
  const changed = {
    ...draft,
    form: { ...draft.form, requireProjectApproval: false },
  };
  expect(settingsDraftDiff(changed)).toHaveLength(1);
  expect(settingsDraftPayload(changed)).toEqual({
    requireProjectApproval: false,
    reviewerMode: "independent_reviewer",
  });
  expect(settingChangeLabel(false)).toBe("关闭");
  expect(settingChangeLabel("independent_reviewer")).toContain("不可自审");
});
it("有效空白修剪不伪造变化，非法填写仍保留在草稿中", () => {
  const draft = createSettingsDraft(
    "general",
    { platformName: "Original", watermarkEnabled: false, watermarkText: "" },
    "token"
  );
  const changed = {
    ...draft,
    form: { ...draft.form, platformName: " Original " },
  };
  expect(settingsDraftDiff(changed)).toHaveLength(1);
  expect(settingsDraftPayload(changed)).toEqual({
    platformName: "Original",
    watermarkEnabled: false,
    watermarkText: "",
  });
  const invalid = { ...draft, form: { ...draft.form, watermarkEnabled: true } };
  expect(() => settingsDraftPayload(invalid)).toThrow("水印文本");
  expect(invalid.form.watermarkEnabled).toBe(true);
});
