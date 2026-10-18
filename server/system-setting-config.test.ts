import { expect, it } from "vitest";
import {
  assertSystemSettingConfigToken,
  DEFAULT_SYSTEM_SETTINGS,
  mergeSystemSettingValue,
  systemSettingConfigToken,
} from "./system-setting-config";
it("键顺序不影响快照，配置内容、类别及额外字段变化会改变快照", () => {
  const value = DEFAULT_SYSTEM_SETTINGS.general;
  expect(systemSettingConfigToken("general", value)).toBe(
    systemSettingConfigToken("general", {
      watermarkText: "",
      platformName: "Flow AI Engine",
      watermarkEnabled: false,
    })
  );
  expect(systemSettingConfigToken("general", null)).toBe(
    systemSettingConfigToken("general", value)
  );
  expect(
    systemSettingConfigToken("general", { ...value, platformName: "Other" })
  ).not.toBe(systemSettingConfigToken("general", value));
  expect(
    systemSettingConfigToken("general", { ...value, custom: true })
  ).not.toBe(systemSettingConfigToken("general", value));
  expect(systemSettingConfigToken("approval", value)).not.toBe(
    systemSettingConfigToken("general", value)
  );
});
it("缺少和过期快照均拒绝，有效快照接受", () => {
  const value = DEFAULT_SYSTEM_SETTINGS.approval;
  expect(() =>
    assertSystemSettingConfigToken("approval", undefined, value)
  ).toThrow("先读取");
  expect(() =>
    assertSystemSettingConfigToken("approval", "0".repeat(64), value)
  ).toThrow("其他管理员");
  expect(() =>
    assertSystemSettingConfigToken(
      "approval",
      systemSettingConfigToken("approval", value),
      value
    )
  ).not.toThrow();
});
it.each([
  ["general", { platformName: "" }],
  ["general", { watermarkEnabled: "yes" }],
  ["general", { watermarkText: 1 }],
  ["general", { platformName: "a".repeat(121) }],
  ["approval", { requireProjectApproval: "false" }],
  ["approval", { reviewerMode: "other" }],
] as const)("拒绝 %s 的无效配置", (key, patch) =>
  expect(() => mergeSystemSettingValue(key, null, patch)).toThrow()
);
it("保存时规范化文本并保留未编辑字段", () => {
  expect(
    mergeSystemSettingValue(
      "general",
      { ...DEFAULT_SYSTEM_SETTINGS.general, futureOption: { enabled: true } },
      { platformName: " Name " }
    )
  ).toEqual({
    ...DEFAULT_SYSTEM_SETTINGS.general,
    platformName: "Name",
    futureOption: { enabled: true },
  });
});
