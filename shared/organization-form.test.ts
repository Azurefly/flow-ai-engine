import { expect, it } from "vitest";
import {
  initialOrganizationDraft,
  mergeOrganizationFields,
  organizationDraftKey,
} from "./organization-form";
it("根、同级、子级与编辑表单使用打开时的目标快照", () => {
  const unit = {
    id: "a",
    parentUnitId: "parent",
    code: "AA",
    name: "原名称",
    managerUserId: 2,
    configToken: "token",
  };
  expect(
    initialOrganizationDraft({ kind: "unit", mode: "root", unit }).fields
      .parentUnitId
  ).toBe("");
  expect(
    initialOrganizationDraft({ kind: "unit", mode: "child", unit }).fields
      .parentUnitId
  ).toBe("a");
  expect(
    initialOrganizationDraft({ kind: "unit", mode: "sibling", unit }).fields
      .parentUnitId
  ).toBe("parent");
  const form = initialOrganizationDraft({ kind: "unit", mode: "edit", unit });
  expect(form.fields).toMatchObject({
    code: "AA",
    name: "原名称",
    managerUserId: "2",
  });
  unit.name = "其他管理员修改";
  expect(form.fields.name).toBe("原名称");
});
it("合并仅更新未编辑字段，保留当前输入，包括主动清空", () => {
  const base = { name: "原名称", description: "原说明", managerUserId: "1" };
  expect(
    mergeOrganizationFields(
      base,
      { name: "本次名称", description: "", managerUserId: "1" },
      { name: "新名称", description: "新说明", managerUserId: "2" }
    )
  ).toEqual({ name: "本次名称", description: "", managerUserId: "2" });
});
it("不同操作、成员、快照有独立草稿，不复用已确认的旧表单", () => {
  const unit = { id: "a", configToken: "old" };
  const key = organizationDraftKey({ kind: "unit", mode: "edit", unit });
  expect(
    organizationDraftKey({
      kind: "unit",
      mode: "edit",
      unit: { ...unit, configToken: "new" },
    })
  ).not.toBe(key);
  expect(organizationDraftKey({ kind: "unit", mode: "child", unit })).not.toBe(
    key
  );
  expect(
    organizationDraftKey({
      kind: "move",
      unit,
      member: { userId: 1, membershipToken: "a" },
    })
  ).not.toBe(
    organizationDraftKey({
      kind: "move",
      unit,
      member: { userId: 2, membershipToken: "a" },
    })
  );
});

it("编辑成员保留账号和岗位快照，迁移合并默认需要确认", () => {
  const unit = { id: "a", unitType: null, managerUserId: null };
  expect(
    initialOrganizationDraft({ kind: "unit", mode: "edit", unit }).fields
      .unitType
  ).toBe("");
  const member = {
    userId: 9,
    title: "原岗位",
    isPrimary: false,
    membershipToken: "snapshot",
  };
  const editing = initialOrganizationDraft({ kind: "member", unit, member });
  expect(editing.fields).toMatchObject({
    userId: "9",
    title: "原岗位",
    isPrimary: false,
  });
  expect(editing.membershipToken).toBe("snapshot");
  expect(
    initialOrganizationDraft({ kind: "move", unit, member }).fields.confirmMerge
  ).toBe(false);
});
