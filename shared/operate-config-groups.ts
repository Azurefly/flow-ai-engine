export const OPERATE_CONFIG_GROUPS = [
  { label: "基本信息", keys: ["nodeDh", "czmc", "instruction"] },
  {
    label: "处理人",
    keys: [
      "assigneeMode",
      "assigneeUserId",
      "assigneeRoleCode",
      "assigneeUnitIds",
      "includeDescendants",
      "managerLevel",
      "assigneeFormField",
      "assigneeFallback",
    ],
  },
  {
    label: "表单与时限",
    keys: [
      "formSchemaVersion",
      "formSchema",
      "dueAfterSeconds",
      "reminderAfterSeconds",
      "escalationAfterSeconds",
    ],
  },
  { label: "结果与分支", keys: ["outcomeMode", "outcomes"] },
  {
    label: "高级配置",
    keys: [
      "lsWorkZone",
      "bddxcrjsrsx",
      "bdczcrjsrsx",
      "qxkz",
      "bddx",
      "bdcz",
      "sxsz",
      "fsfsz",
      "jsfsz",
      "zdzx",
    ],
  },
];
