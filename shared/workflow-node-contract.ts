import { normalizeReferenceOperateConfig } from "./reference-operate-config";
import { normalizeReferenceRouterConfig } from "./reference-router-config";

export type FlowType = "state" | "control" | "data";

export const FLOW_NODE_TYPES = [
  "start",
  "end",
  "transform",
  "condition",
  "http",
  "llm",
  "subflow",
  "state",
  "operate",
  "router",
  "rest",
  "method",
  "form",
  "sql",
  "source",
  "table",
  "filter",
  "map",
  "udf",
  "sink",
  "output",
  "edit_sql",
] as const;

export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];
export type NodeConfig = Record<string, unknown>;

export type OperateOutcome = {
  code: string;
  label: string;
  sourceHandle: string;
  requireComment?: boolean;
};

export type OperateOutcomeMode = "explicit" | "legacy_cancel";

export function readOperateOutcomeMode(config: NodeConfig): OperateOutcomeMode {
  return config.outcomeMode === "explicit" && Array.isArray(config.outcomes)
    ? "explicit"
    : "legacy_cancel";
}

export function readOperateOutcomes(config: NodeConfig): OperateOutcome[] {
  if (readOperateOutcomeMode(config) !== "explicit") return [];
  return (config.outcomes as unknown[])
    .filter(item => item && typeof item === "object" && !Array.isArray(item))
    .map(item => {
      const outcome = item as NodeConfig;
      return {
        code: String(outcome.code ?? "").trim(),
        label: String(outcome.label ?? outcome.code ?? "").trim(),
        sourceHandle: String(outcome.sourceHandle ?? outcome.code ?? "").trim(),
        ...(outcome.requireComment === true ? { requireComment: true } : {}),
      };
    });
}

/** Shared source/target contract used by both the designer and publish-time validation. */
export const FLOW_NODE_ALLOWED_TARGETS: Partial<
  Record<FlowNodeType, readonly FlowNodeType[]>
> = {
  start: [
    "state",
    "operate",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "sql",
    "source",
    "table",
    "filter",
    "map",
    "edit_sql",
    "udf",
    "sink",
    "output",
    "end",
  ],
  state: [
    "operate",
    "state",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  operate: [
    "state",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  router: [
    "state",
    "operate",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  rest: [
    "state",
    "operate",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  method: [
    "state",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  form: [
    "state",
    "operate",
    "router",
    "rest",
    "method",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  subflow: [
    "state",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  condition: [
    "state",
    "operate",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  transform: [
    "state",
    "operate",
    "router",
    "rest",
    "method",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "filter",
    "map",
    "sink",
    "output",
    "end",
  ],
  http: [
    "state",
    "operate",
    "router",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  llm: [
    "state",
    "operate",
    "router",
    "form",
    "transform",
    "condition",
    "http",
    "llm",
    "subflow",
    "end",
  ],
  sql: [
    "transform",
    "condition",
    "filter",
    "map",
    "udf",
    "sink",
    "output",
    "end",
  ],
  source: [
    "table",
    "filter",
    "map",
    "edit_sql",
    "udf",
    "sink",
    "output",
    "end",
  ],
  table: ["filter", "map", "edit_sql", "udf", "sink", "output", "end"],
  filter: ["filter", "map", "edit_sql", "udf", "sink", "output", "end"],
  map: ["filter", "map", "edit_sql", "udf", "sink", "output", "end"],
  edit_sql: ["filter", "map", "udf", "sink", "output", "end"],
  udf: ["filter", "map", "edit_sql", "udf", "sink", "output", "end"],
  sink: ["end"],
  output: ["end"],
  end: [],
};

export function canConnectFlowNodeTypes(
  source: FlowNodeType,
  target: FlowNodeType
) {
  if (source === "end" || target === "start") return false;
  const allowed = FLOW_NODE_ALLOWED_TARGETS[source];
  return !allowed || allowed.includes(target);
}

export type NodeField = {
  key: string;
  label: string;
  help: string;
  required?: boolean;
  kind:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "json"
    | "template";
  options?: Array<{ value: string; label: string }>;
  aliases?: string[];
};

export type FlowNodeDefinition = {
  type: FlowNodeType;
  label: string;
  description: string;
  /** 节点及字段默认值是否已经由完整安装包或原后端源码直接确认。 */
  configEvidence?: "reference-confirmed" | "compatibility-extension";
  flowTypes: FlowType[];
  defaultConfig: NodeConfig;
  fields: NodeField[];
};

const conditionOperators = [
  { value: "equals", label: "等于" },
  { value: "notEquals", label: "不等于" },
  { value: "contains", label: "包含" },
  { value: "exists", label: "存在" },
  { value: "greaterThan", label: "大于" },
  { value: "lessThan", label: "小于" },
];

const templateHelp =
  "支持 {{input.field}}、{{vars.field}} 与 {{nodes.节点ID.字段}}，不执行任意表达式。";

const referenceHttpDefaultConfig = {
  nodeDh: "",
  restmc: "",
  restType: "POST",
  restApi: "",
  restHeaderParam: [{ key: "", value: "" }],
  restGetBodyParam: [{ key: "", value: "" }],
  restJsonParam: "",
  restAttributeMap: {
    valid: false,
    suspend: true,
    async: false,
    restEntryParam: {},
  },
  restScriptCode: "",
  endpoint: "",
  endpointRef: "",
  secretRef: "",
  method: "POST",
  headers: {},
  body: {},
  timeout: 15000,
  writeSafety: "unconfigured",
  compensationNodeId: "",
  retryMaxAttempts: 1,
  retryBaseDelayMs: 250,
  circuitFailureThreshold: 5,
  circuitResetMs: 30000,
  concurrencyKey: "",
  concurrencyLimit: 5,
};

const referenceHttpFields: NodeField[] = [
  {
    key: "nodeDh",
    aliases: ["code"],
    label: "节点代号",
    help: "原版代号由流程、节点类型和自定义段组成；自定义段仅允许数字和字母。",
    kind: "text",
    required: true,
  },
  {
    key: "restmc",
    label: "节点名称",
    help: "原版节点配置中保留的名称；画布节点名称仍是当前显示名称。",
    kind: "text",
    required: true,
  },
  {
    key: "restType",
    aliases: ["method"],
    label: "请求方法",
    help: "原版仅提供 GET 和 POST；当前安全运行时也兼容 PUT、PATCH、DELETE。",
    kind: "select",
    required: true,
    options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map(value => ({
      value,
      label: value,
    })),
  },
  {
    key: "endpointRef",
    label: "项目 EndpointRef",
    help: "项目流程必须引用项目服务端点目录；配置后接口地址只能填写相对路径。",
    kind: "text",
  },
  {
    key: "secretRef",
    label: "SecretRef",
    help: "仅保存外部密钥引用，不保存密钥值；必须与项目端点登记的引用一致。",
    kind: "text",
  },
  {
    key: "restApi",
    aliases: ["endpoint", "url"],
    label: "接口地址",
    help: `${templateHelp} 服务端拒绝本机、私有网段、凭据 URL 与非标准端口。`,
    kind: "template",
    required: true,
  },
  {
    key: "restHeaderParam",
    aliases: ["headers"],
    label: "请求头",
    help: "原版键值项数组；也兼容当前版本的对象结构。Host、Connection 与 Content-Length 会被服务端剔除。",
    kind: "json",
  },
  {
    key: "restGetBodyParam",
    label: "GET 入参",
    help: "原版 GET 键值项数组，执行时作为查询参数附加到接口地址。",
    kind: "json",
  },
  {
    key: "restJsonParam",
    aliases: ["body"],
    label: "POST 请求体",
    help: "原版 JSON 请求体文本或当前结构化请求体；支持受限模板变量。",
    kind: "json",
  },
  {
    key: "restAttributeMap",
    label: "执行与校验设置",
    help: "原版字段：async、valid、suspend、restEntryParam。配置会完整保存；任意校验脚本不会在未隔离环境中直接执行。",
    kind: "json",
    required: true,
  },
  {
    key: "restScriptCode",
    label: "响应校验脚本",
    help: "保留原版响应校验脚本以便迁移；当前安全运行时不直接执行任意旧脚本。",
    kind: "textarea",
  },
  {
    key: "timeout",
    label: "超时（毫秒）",
    help: "当前安全扩展，服务端限制为 1,000 至 15,000 毫秒。",
    kind: "number",
  },
  {
    key: "writeSafety",
    label: "写操作安全策略",
    help: "POST/PUT/PATCH/DELETE 发布前必须声明远端幂等或配置补偿节点。",
    kind: "select",
    options: [
      { value: "unconfigured", label: "尚未配置" },
      { value: "idempotent", label: "远端支持幂等键" },
      { value: "compensated", label: "失败时进入补偿节点" },
    ],
  },
  { key: "compensationNodeId", label: "补偿节点 ID", help: "写操作选择补偿策略时必须指向当前流程中的后继补偿节点。", kind: "text" },
  { key: "retryMaxAttempts", label: "最大尝试次数", help: "范围 1 至 5；包含首次执行。", kind: "number" },
  { key: "retryBaseDelayMs", label: "重试基础延迟", help: "指数退避基础延迟，范围 50 至 5,000 毫秒。", kind: "number" },
  { key: "circuitFailureThreshold", label: "熔断失败阈值", help: "同一并发键连续失败达到阈值后临时熔断。", kind: "number" },
  { key: "circuitResetMs", label: "熔断恢复时间", help: "范围 1,000 至 300,000 毫秒。", kind: "number" },
  { key: "concurrencyKey", label: "并发限制键", help: "相同键的任务共享并发配额；留空按 EndpointRef 或域名分组。", kind: "text" },
  { key: "concurrencyLimit", label: "并发上限", help: "单 Worker 范围 1 至 50。", kind: "number" },
];

export const FLOW_NODE_DEFINITIONS: Record<FlowNodeType, FlowNodeDefinition> = {
  start: {
    type: "start",
    label: "开始",
    description: "初始化流程输入变量",
    flowTypes: ["state", "control", "data"],
    defaultConfig: { initialVariables: {} },
    fields: [
      {
        key: "initialVariables",
        label: "初始变量",
        help: "流程启动时写入 vars 的 JSON 对象。",
        kind: "json",
        required: true,
      },
    ],
  },
  end: {
    type: "end",
    label: "结束",
    description: "输出最终运行结果",
    flowTypes: ["state", "control", "data"],
    defaultConfig: { resultTemplate: "{{vars}}" },
    fields: [
      {
        key: "resultTemplate",
        label: "结果模板",
        help: templateHelp,
        kind: "template",
        required: true,
      },
    ],
  },
  state: {
    type: "state",
    label: "状态节点",
    description: "记录业务或系统状态",
    configEvidence: "reference-confirmed",
    flowTypes: ["state", "control"],
    defaultConfig: {
      nodeDh: "",
      jdmc: "业务状态",
      bdjs: [],
      jdgycz: [],
      ywcz: [{ czid: "", czmc: "" }],
      stateColor: "",
      flowStatus: "",
      bdym: "",
      stateCode: "STATE_CODE",
      displayName: "业务状态",
      stateType: "business",
    },
    fields: [
      {
        key: "nodeDh",
        aliases: ["stateCode"],
        label: "状态代号",
        help: "原版代号仅允许数字和字母；用于状态流识别和审计。",
        kind: "text",
        required: true,
      },
      {
        key: "jdmc",
        aliases: ["displayName"],
        label: "状态名称",
        help: "原版状态节点名称。",
        kind: "text",
        required: true,
      },
      {
        key: "bdjs",
        label: "绑定角色",
        help: "原版绑定角色对象数组。",
        kind: "json",
      },
      {
        key: "jdgycz",
        label: "状态固有操作",
        help: "原版办结、自动办结、同时办结所有子流程、撤诉配置。",
        kind: "json",
      },
      {
        key: "ywcz",
        label: "业务操作",
        help: "原版操作 ID 与操作名称数组。",
        kind: "json",
      },
      {
        key: "stateColor",
        label: "状态颜色",
        help: "原版状态节点颜色。",
        kind: "text",
      },
      {
        key: "flowStatus",
        label: "流程状态",
        help: "原版流程状态文案。",
        kind: "text",
      },
      {
        key: "bdym",
        label: "绑定页面",
        help: "BDOS 场景下的原版绑定页面标识。",
        kind: "text",
      },
      {
        key: "stateType",
        label: "状态类型",
        help: "区分业务状态和系统状态。",
        kind: "select",
        options: [
          { value: "business", label: "业务状态" },
          { value: "system", label: "系统状态" },
          { value: "terminal", label: "业务终态" },
        ],
        required: true,
      },
    ],
  },
  operate: {
    type: "operate",
    label: "操作节点",
    description: "创建可领取、可审计的人工操作",
    configEvidence: "reference-confirmed",
    flowTypes: ["state", "control"],
    defaultConfig: {
      nodeDh: "",
      czmc: "",
      lsWorkZone: "",
      bddxcrjsrsx: false,
      bdczcrjsrsx: false,
      qxkz: [],
      bddx: [],
      bdcz: {
        bdcz: [{ id: "", text: "" }],
        bdczjs: [],
        hqhqsz: "",
        xzdfhq: {},
        hqtgbfb: "",
      },
      sxsz: { zdglxgfsz: [], yrdbmsfkcz: "否", xzdzlcjywc: [] },
      fsfsz: {
        fsfbm: "",
        fsflzsf: "以本人身份",
        fsfgycz: "",
        lsjspz: [{ pzlx: "赋予", xzjs: [] }],
      },
      jsfsz: { jsfbm: "", jsfgycz: "", lsjspz: [{ pzlx: "赋予", xzjs: [] }] },
      zdzx: { sfzdzx: "否", tjsz: [], code: [] },
      commandCode: "COMMAND_CODE",
      assigneeMode: "receivers",
      assigneeRoleCode: "",
      instruction: "请完成此项流程操作。",
      formSchemaVersion: 1,
      formSchema: { fields: [] },
      dueAfterSeconds: 0,
      reminderAfterSeconds: 0,
      escalationAfterSeconds: 0,
      outcomeMode: "explicit",
      outcomes: [
        {
          code: "approved",
          label: "同意",
          sourceHandle: "approved",
        },
        {
          code: "rejected",
          label: "拒绝",
          sourceHandle: "rejected",
          requireComment: true,
        },
      ],
    },
    fields: [
      {
        key: "nodeDh",
        aliases: ["commandCode"],
        label: "操作代号",
        help: "原版操作节点代号，仅允许数字和字母。",
        kind: "text",
        required: true,
      },
      {
        key: "czmc",
        label: "操作名称",
        help: "原版操作节点名称。",
        kind: "text",
        required: true,
      },
      {
        key: "lsWorkZone",
        label: "隶属 WorkZone",
        help: "原版操作节点所属工作域。",
        kind: "text",
      },
      {
        key: "bddxcrjsrsx",
        label: "绑定对象传入接收人生效",
        help: "原版布尔配置。",
        kind: "boolean",
      },
      {
        key: "bdczcrjsrsx",
        label: "绑定操作传入接收人生效",
        help: "原版布尔配置。",
        kind: "boolean",
      },
      {
        key: "qxkz",
        label: "权限控制",
        help: "原版权限、发送方、接收方和过滤条件结构。",
        kind: "json",
      },
      {
        key: "bddx",
        label: "绑定对象",
        help: "原版绑定对象、获取范围和双方设置。",
        kind: "json",
      },
      {
        key: "bdcz",
        label: "绑定操作",
        help: "原版绑定操作、或签/会签和角色配置。",
        kind: "json",
      },
      {
        key: "sxsz",
        label: "属性设置",
        help: "原版自动关联、部门可操作和子流程完成条件。",
        kind: "json",
      },
      {
        key: "fsfsz",
        label: "发送方设置",
        help: "原版发送方身份、固有操作和临时角色配置。",
        kind: "json",
      },
      {
        key: "jsfsz",
        label: "接收方设置",
        help: "原版接收方固有操作和临时角色配置。",
        kind: "json",
      },
      {
        key: "zdzx",
        label: "自动执行",
        help: "原版自动执行、条件和代码配置；任意旧代码不会直接执行。",
        kind: "json",
      },
      {
        key: "assigneeMode",
        label: "处理人方式",
        help: "人工操作必须解析为明确的当前处理人或候选人，不允许全员开放领取。",
        kind: "select",
        required: true,
        options: [
          { value: "receivers", label: "上一步接收方" },
          { value: "role", label: "权限角色" },
          { value: "user", label: "指定用户" },
          { value: "initiator", label: "流程发起人" },
          { value: "initiator_manager", label: "发起人直属上级" },
          { value: "sender_manager", label: "当前操作人直属上级" },
          { value: "initiator_manager_n", label: "发起人 N 级主管" },
          { value: "sender_manager_n", label: "当前操作人 N 级主管" },
          { value: "department", label: "指定部门成员" },
          { value: "department_manager", label: "部门负责人" },
          { value: "form_user", label: "表单用户字段" },
        ],
      },
      {
        key: "assigneeFallback",
        label: "无人候选兜底",
        help: "默认失败并阻塞流程；可安全回退到流程发起人或流程所有者，不会默认开放给所有用户。",
        kind: "select",
        options: [
          { value: "error", label: "失败并阻塞" },
          { value: "initiator", label: "回退发起人" },
          { value: "owner", label: "回退流程所有者" },
        ],
      },
      {
        key: "assigneeRoleCode",
        label: "处理人角色代号",
        help: "“权限角色”方式使用；匹配系统级或当前流程范围内的有效角色授权。",
        kind: "text",
      },
      {
        key: "instruction",
        label: "操作说明",
        help: templateHelp,
        kind: "textarea",
        required: true,
      },
      {
        key: "formSchemaVersion",
        label: "表单版本",
        help: "任务创建时固化的表单 Schema 版本，发布后已有任务不会跟随草稿变化。",
        kind: "number",
        required: true,
      },
      {
        key: "formSchema",
        label: "任务表单 Schema",
        help: "JSON 格式的字段定义；任务创建时连同版本一起固化到任务快照。",
        kind: "json",
      },
      {
        key: "dueAfterSeconds",
        label: "办理时限（秒）",
        help: "大于 0 时从任务创建时间计算截止时间；0 表示不设时限。",
        kind: "number",
      },
      {
        key: "reminderAfterSeconds",
        label: "提醒时间（秒）",
        help: "预留给提醒调度器；必须不晚于办理时限。0 表示不提醒。",
        kind: "number",
      },
      {
        key: "escalationAfterSeconds",
        label: "升级时间（秒）",
        help: "预留给升级调度器；必须不早于提醒时间。0 表示不升级。",
        kind: "number",
      },
      {
        key: "assigneeUserId",
        label: "指定处理人 ID",
        help: "仅“指定用户”方式需要；必须为可用内部账号。",
        kind: "number",
      },
      {
        key: "managerLevel",
        label: "主管层级",
        help: "N 级主管方式使用，范围 1 至 32。",
        kind: "number",
      },
      {
        key: "assigneeUnitIds",
        label: "处理部门 ID",
        help: "指定部门成员或部门负责人方式使用。",
        kind: "json",
      },
      {
        key: "includeDescendants",
        label: "包含后代部门",
        help: "指定部门成员时是否递归包含所有启用的后代部门。",
        kind: "boolean",
      },
      {
        key: "assigneeFormField",
        label: "表单用户字段",
        help: "表单用户方式使用，例如 input.approverUserId。",
        kind: "text",
      },
      {
        key: "outcomeMode",
        label: "结果路由模式",
        help: "新流程使用显式结果出口；旧流程可暂时保留拒绝即取消的兼容行为。",
        kind: "select",
        required: true,
        options: [
          { value: "explicit", label: "显式结果出口" },
          { value: "legacy_cancel", label: "旧版拒绝即取消" },
        ],
      },
      {
        key: "outcomes",
        label: "操作结果出口",
        help: "每项配置 code、label、sourceHandle，可用 requireComment 强制填写意见。",
        kind: "json",
      },
    ],
  },
  router: {
    type: "router",
    label: "路由节点",
    description: "按分支规则选择后继连线",
    configEvidence: "reference-confirmed",
    flowTypes: ["state", "control"],
    defaultConfig: {
      nodeDh: "",
      lymc: "",
      gbms: false,
      lysz: [],
      routes: [],
      defaultRoute: "default",
    },
    fields: [
      {
        key: "nodeDh",
        label: "路由代号",
        help: "原版路由节点代号，仅允许数字和字母。",
        kind: "text",
        required: true,
      },
      {
        key: "lymc",
        label: "路由名称",
        help: "原版路由节点名称。",
        kind: "text",
        required: true,
      },
      {
        key: "gbms",
        label: "广播模式",
        help: "原版广播模式开关。",
        kind: "boolean",
        required: true,
      },
      {
        key: "lysz",
        label: "原版路由设置",
        help: "原版路径名称、优先权重、目标节点、权限过滤和代码结构；旧任意代码只保存不直接执行。",
        kind: "json",
      },
      {
        key: "routes",
        label: "路由规则",
        help: "按顺序匹配；每项包含 handle、label 及可选 condition（left、operator、right）。",
        kind: "json",
        required: true,
      },
      {
        key: "defaultRoute",
        label: "默认分支",
        help: "未命中规则时使用的连线句柄；应与画布连线的源句柄一致。",
        kind: "text",
        required: true,
      },
    ],
  },
  rest: {
    type: "rest",
    label: "REST 节点",
    description: "保留原版字段并通过受限网络策略调用外部 REST 服务",
    configEvidence: "reference-confirmed",
    flowTypes: ["state", "control", "data"],
    defaultConfig: referenceHttpDefaultConfig,
    fields: referenceHttpFields,
  },
  method: {
    type: "method",
    label: "方法节点",
    description: "原版 METHOD 节点，复用 REST 持久化与受限调用契约",
    configEvidence: "reference-confirmed",
    flowTypes: ["state", "control"],
    defaultConfig: referenceHttpDefaultConfig,
    fields: referenceHttpFields,
  },
  form: {
    type: "form",
    label: "表单节点",
    description: "定义流程实例需要提交的字段",
    flowTypes: ["state", "control"],
    defaultConfig: { fields: [] },
    fields: [
      {
        key: "fields",
        label: "表单字段",
        help: "数组项包含 key、label、type、required，可选 placeholder、defaultValue、options。",
        kind: "json",
        required: true,
      },
    ],
  },
  sql: {
    type: "sql",
    label: "SQL 节点",
    description: "数据流程只读 SQL 计划",
    flowTypes: ["data"],
    defaultConfig: {
      datasourceId: "",
      statement: "SELECT * FROM source",
      parameters: {},
    },
    fields: [
      {
        key: "datasourceId",
        label: "数据源",
        help: "引用项目内的数据源标识，不暴露连接凭据。",
        kind: "text",
        required: true,
      },
      {
        key: "statement",
        label: "SQL 语句",
        help: "仅允许单条只读查询；不允许 DDL、DML 或多语句。",
        kind: "textarea",
        required: true,
      },
      {
        key: "parameters",
        label: "参数",
        help: "供 SQL 模板或数据流执行器使用的 JSON 参数对象。",
        kind: "json",
      },
    ],
  },
  transform: {
    type: "transform",
    label: "转换",
    description: "将模板化字段映射为新的节点输出",
    flowTypes: ["state", "control", "data"],
    defaultConfig: { mappings: {} },
    fields: [
      {
        key: "mappings",
        label: "字段映射",
        help: templateHelp,
        kind: "json",
        required: true,
      },
    ],
  },
  condition: {
    type: "condition",
    label: "条件",
    description: "选择 true 或 false 分支",
    flowTypes: ["state", "control", "data"],
    defaultConfig: {
      left: "{{input.value}}",
      operator: "equals",
      right: true,
      trueHandle: "true",
      falseHandle: "false",
    },
    fields: [
      {
        key: "left",
        label: "左值",
        help: templateHelp,
        kind: "template",
        required: true,
      },
      {
        key: "operator",
        label: "比较方式",
        help: "使用严格比较、包含、存在或数值比较。",
        kind: "select",
        required: true,
        options: conditionOperators,
      },
      {
        key: "right",
        label: "右值",
        help: "可使用 JSON 标量或模板。",
        kind: "json",
      },
      {
        key: "trueHandle",
        label: "成立分支句柄",
        help: "匹配时选择的源句柄。",
        kind: "text",
        required: true,
      },
      {
        key: "falseHandle",
        label: "不成立分支句柄",
        help: "不匹配时选择的源句柄。",
        kind: "text",
        required: true,
      },
    ],
  },
  llm: {
    type: "llm",
    label: "LLM",
    description: "调用运行时可用模型目录",
    flowTypes: ["state", "control"],
    defaultConfig: {
      model: "",
      systemPrompt: "你是一名严谨的工作流助手。",
      prompt: "{{input.prompt}}",
      maxTokens: 1024,
      timeoutMs: 30000,
      failureHandle: "",
    },
    fields: [
      {
        key: "model",
        label: "模型",
        help: "从运行时模型目录选择；留空使用目录首个模型，指定了目录外模型时运行失败。",
        kind: "text",
      },
      {
        key: "systemPrompt",
        label: "系统提示词",
        help: templateHelp,
        kind: "textarea",
        required: true,
      },
      {
        key: "prompt",
        label: "用户提示词",
        help: templateHelp,
        kind: "textarea",
        required: true,
      },
      {
        key: "maxTokens",
        label: "最大输出令牌",
        help: "服务端限制为 64 至 8,192。",
        kind: "number",
      },
      {
        key: "timeoutMs",
        label: "超时（毫秒）",
        help: "单个 LLM 请求超时范围为 1,000 至 120,000 毫秒。",
        kind: "number",
      },
      {
        key: "outputSchema",
        label: "结构化输出 Schema",
        help: "可选 { name, schema, strict } 对象；模型输出将解析为 structured 字段。",
        kind: "json",
      },
      {
        key: "failureHandle",
        label: "失败分支句柄",
        help: "LLM 超时、Provider 或结构化解析失败时，沿此句柄进入补偿/人工处理分支。",
        kind: "text",
      },
    ],
  },
  subflow: {
    type: "subflow",
    label: "子流程",
    description: "调用当前所有者的可复用私有流程",
    configEvidence: "reference-confirmed",
    flowTypes: ["state", "control", "data"],
    defaultConfig: {
      zlcxz: { id: "", text: "" },
      nodeDh: "",
      sfgqzlc: true,
      zlcfqf: "sender",
      gdtj: [],
      zlcrk: {},
      zlcck: [{ connect: { id: "", text: "", yId: "" }, end: "" }],
      executionMode: "sync_snapshot",
      subflowId: "",
      input: "{{input}}",
    },
    fields: [
      {
        key: "zlcxz",
        label: "原版流程选择",
        help: "原版子流程 ID 与名称；迁移时需映射为当前所有者的已启用私有子流程。",
        kind: "json",
        required: true,
      },
      {
        key: "nodeDh",
        label: "子流程代号",
        help: "原版子流程节点代号，仅允许数字和字母。",
        kind: "text",
        required: true,
      },
      {
        key: "sfgqzlc",
        label: "挂起主流程（兼容字段）",
        help: "仅保留原版定义；当前运行时始终同步等待已发布快照。",
        kind: "boolean",
        required: true,
      },
      {
        key: "zlcfqf",
        label: "子流程发起方（兼容字段）",
        help: "仅保留原版 sender/receiver 定义；当前以父流程输入映射执行。",
        kind: "select",
        required: true,
        options: [
          { value: "sender", label: "基于发送方" },
          { value: "receiver", label: "基于接收方" },
        ],
      },
      {
        key: "gdtj",
        label: "更多条件（兼容字段）",
        help: "当前安全运行时不解释原版任意条件代码。",
        kind: "json",
      },
      {
        key: "zlcrk",
        label: "子流程入口（兼容字段）",
        help: "当前请使用下方“传入数据”作为权威入口映射。",
        kind: "json",
        required: true,
      },
      {
        key: "zlcck",
        label: "子流程出口（兼容字段）",
        help: "当前子流程结果固定写入节点 result，不解释原版出口数组。",
        kind: "json",
      },
      {
        key: "executionMode",
        label: "执行模式",
        help: "当前仅支持同步等待发布时固定的子流程快照。",
        kind: "select",
        required: true,
        options: [{ value: "sync_snapshot", label: "同步等待·固定快照" }],
      },
      {
        key: "subflowId",
        label: "当前子流程标识",
        help: "当前安全运行时使用；必须属于流程所有者且已启用。",
        kind: "text",
        required: true,
      },
      { key: "input", label: "传入数据", help: templateHelp, kind: "json" },
    ],
  },
  http: {
    type: "http",
    label: "HTTP",
    description: "受限外部请求的兼容节点",
    flowTypes: ["state", "control", "data"],
    defaultConfig: {
      method: "GET",
      url: "",
      endpointRef: "",
      secretRef: "",
      headers: {},
      body: {},
      timeout: 15000,
      writeSafety: "unconfigured",
      compensationNodeId: "",
      retryMaxAttempts: 1,
      retryBaseDelayMs: 250,
      circuitFailureThreshold: 5,
      circuitResetMs: 30000,
      concurrencyKey: "",
      concurrencyLimit: 5,
    },
    fields: [
      {
        key: "endpointRef",
        label: "项目 EndpointRef",
        help: "项目流程必须引用项目服务端点目录；配置后 URL 只能填写相对路径。",
        kind: "text",
      },
      {
        key: "secretRef",
        label: "SecretRef",
        help: "仅保存外部密钥引用，不保存密钥值；必须与项目端点登记的引用一致。",
        kind: "text",
      },
      {
        key: "url",
        label: "请求地址",
        help: "兼容节点；使用与 REST 节点相同的 SSRF 防护。",
        kind: "template",
        required: true,
      },
      {
        key: "method",
        label: "请求方法",
        help: "支持 GET、POST、PUT、PATCH、DELETE。",
        kind: "select",
        required: true,
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map(value => ({
          value,
          label: value,
        })),
      },
      { key: "headers", label: "请求头", help: "JSON 对象。", kind: "json" },
      { key: "body", label: "请求体", help: templateHelp, kind: "json" },
      {
        key: "timeout",
        label: "超时（毫秒）",
        help: "服务端限制为 1,000 至 15,000 毫秒。",
        kind: "number",
      },
      { key: "writeSafety", label: "写操作安全策略", help: "写请求发布前必须声明远端幂等或配置补偿节点。", kind: "select", options: [{ value: "unconfigured", label: "尚未配置" }, { value: "idempotent", label: "远端支持幂等键" }, { value: "compensated", label: "失败时进入补偿节点" }] },
      { key: "compensationNodeId", label: "补偿节点 ID", help: "补偿策略使用。", kind: "text" },
      { key: "retryMaxAttempts", label: "最大尝试次数", help: "范围 1 至 5。", kind: "number" },
      { key: "retryBaseDelayMs", label: "重试基础延迟", help: "范围 50 至 5,000 毫秒。", kind: "number" },
      { key: "circuitFailureThreshold", label: "熔断失败阈值", help: "范围 1 至 20。", kind: "number" },
      { key: "circuitResetMs", label: "熔断恢复时间", help: "范围 1,000 至 300,000 毫秒。", kind: "number" },
      { key: "concurrencyKey", label: "并发限制键", help: "留空按 EndpointRef 或域名分组。", kind: "text" },
      { key: "concurrencyLimit", label: "并发上限", help: "单 Worker 范围 1 至 50。", kind: "number" },
    ],
  },
  source: {
    type: "source",
    label: "资源",
    description: "引用项目内已探查的数据资源",
    flowTypes: ["data"],
    defaultConfig: { assetId: "" },
    fields: [
      {
        key: "assetId",
        label: "资源",
        help: "项目隔离的数据资源标识。",
        kind: "text",
        required: true,
      },
    ],
  },
  table: {
    type: "table",
    label: "中间表",
    description: "读取项目资源或中间数据集",
    flowTypes: ["data"],
    defaultConfig: { assetId: "" },
    fields: [
      {
        key: "assetId",
        label: "中间表或资源",
        help: "项目隔离的资源标识。",
        kind: "text",
        required: true,
      },
    ],
  },
  filter: {
    type: "filter",
    label: "筛选",
    description: "按字段和值筛选样本行",
    flowTypes: ["data"],
    defaultConfig: { filterField: "", filterValue: "" },
    fields: [
      {
        key: "filterField",
        label: "筛选字段",
        help: "要比较的输出字段名称。",
        kind: "text",
        required: true,
      },
      {
        key: "filterValue",
        label: "筛选值",
        help: templateHelp,
        kind: "template",
      },
    ],
  },
  map: {
    type: "map",
    label: "字段映射",
    description: "选择输出字段并限制行数",
    flowTypes: ["data"],
    defaultConfig: { columns: [], limit: 200 },
    fields: [
      {
        key: "columns",
        label: "输出字段",
        help: "字段名数组；留空可保留输入字段。",
        kind: "json",
      },
      {
        key: "limit",
        label: "最大行数",
        help: "限制数据流输出行数。",
        kind: "number",
      },
    ],
  },
  edit_sql: {
    type: "edit_sql",
    label: "SQL",
    description: "数据流 SQL 编辑节点",
    flowTypes: ["data"],
    defaultConfig: { sql: "SELECT * FROM source" },
    fields: [
      {
        key: "sql",
        label: "SQL",
        help: "仅允许单条只读查询。",
        kind: "textarea",
        required: true,
      },
    ],
  },
  udf: {
    type: "udf",
    label: "UDF",
    description: "引用已审核的项目函数元数据",
    flowTypes: ["data"],
    defaultConfig: { udfId: "" },
    fields: [
      {
        key: "udfId",
        label: "UDF",
        help: "项目隔离且已审核的 UDF 标识。",
        kind: "text",
        required: true,
      },
    ],
  },
  sink: {
    type: "sink",
    label: "输出",
    description: "将数据流结果输出到运行审计",
    flowTypes: ["data"],
    defaultConfig: { outputName: "result" },
    fields: [
      {
        key: "outputName",
        label: "输出名称",
        help: "数据流运行审计中的输出引用名称。",
        kind: "text",
        required: true,
      },
    ],
  },
  output: {
    type: "output",
    label: "输出",
    description: "兼容输出节点",
    flowTypes: ["data"],
    defaultConfig: { outputName: "result" },
    fields: [
      {
        key: "outputName",
        label: "输出名称",
        help: "数据流运行审计中的输出引用名称。",
        kind: "text",
        required: true,
      },
    ],
  },
};

/** 完整安装包和 FlowEnginServer dev 源码已到位；未确认的当前扩展仍保持 compatibility-extension。 */
export function getNodeConfigEvidence(type: FlowNodeType) {
  return (
    FLOW_NODE_DEFINITIONS[type].configEvidence ?? "compatibility-extension"
  );
}

export function isFlowNodeType(value: unknown): value is FlowNodeType {
  return (
    typeof value === "string" &&
    (FLOW_NODE_TYPES as readonly string[]).includes(value)
  );
}

export function createDefaultNodeConfig(type: FlowNodeType): NodeConfig {
  return structuredClone(FLOW_NODE_DEFINITIONS[type].defaultConfig);
}

/** Preserves forward-compatible keys while filling only missing documented defaults. */
export function withNodeConfigDefaults(
  type: FlowNodeType,
  config: NodeConfig
): NodeConfig {
  const merged = Object.entries(config).reduce<NodeConfig>(
    (result, [key, value]) => {
      if (value !== undefined) result[key] = value;
      return result;
    },
    createDefaultNodeConfig(type)
  );
  if (type === "sql") {
    merged.statement = firstNonBlank(
      config.statement,
      config.sql,
      config.query,
      merged.statement
    );
  }
  if (type === "operate" && config.outcomes === undefined) {
    merged.outcomeMode = "legacy_cancel";
    merged.outcomes = [];
  }
  return merged;
}

function assertObject(value: unknown, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(message);
}

function assertString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
}

function firstNonBlank(...values: unknown[]) {
  return values.find(value => typeof value === "string" && value.trim()) as
    | string
    | undefined;
}

function hasMeaningfulLegacyValue(value: unknown): boolean {
  if (typeof value === "string")
    return (
      Boolean(value.trim()) &&
      !["否", "以本人身份", "赋予"].includes(value.trim())
    );
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulLegacyValue);
  if (value && typeof value === "object")
    return Object.values(value as NodeConfig).some(hasMeaningfulLegacyValue);
  return false;
}

function assertOptionalNumber(
  value: unknown,
  message: string,
  min: number,
  max: number
) {
  if (value === undefined || value === null || value === "") return;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(message);
}

function assertOptionalInteger(
  value: unknown,
  message: string,
  min: number,
  max: number
) {
  assertOptionalNumber(value, message, min, max);
  if (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    !Number.isInteger(value)
  )
    throw new Error(message);
}

/** Validates documented properties without deleting unknown keys from an imported historical definition. */
export function validateNodeConfig(type: FlowNodeType, config: NodeConfig) {
  switch (type) {
    case "start":
      assertObject(
        config.initialVariables,
        "开始节点的初始变量必须是 JSON 对象。"
      );
      break;
    case "end": {
      const template = config.resultTemplate;
      if (
        template === undefined ||
        template === null ||
        (typeof template === "string" && !template.trim())
      )
        throw new Error("结束节点必须配置结果模板。");
      break;
    }
    case "state":
      assertString(
        firstNonBlank(config.nodeDh, config.stateCode),
        "状态节点必须配置状态代号。"
      );
      assertString(
        firstNonBlank(config.jdmc, config.displayName),
        "状态节点必须配置状态名称。"
      );
      if (
        !["business", "system", "terminal"].includes(String(config.stateType))
      )
        throw new Error("状态节点类型必须是业务状态、系统状态或业务终态。");
      break;
    case "operate": {
      assertString(
        firstNonBlank(config.nodeDh, config.commandCode),
        "操作节点必须配置操作代号。"
      );
      if (
        config.assigneeFallback !== undefined &&
        !["error", "initiator", "owner"].includes(
          String(config.assigneeFallback)
        )
      )
        throw new Error("操作节点无人候选兜底方式无效。");
      if (
        ![
          "receivers",
          "role",
          "user",
          "initiator",
          "initiator_manager",
          "sender_manager",
          "initiator_manager_n",
          "sender_manager_n",
          "department",
          "department_manager",
          "form_user",
          "none",
        ].includes(String(config.assigneeMode))
      )
        throw new Error("操作节点处理人方式无效。");
      assertString(config.instruction, "操作节点必须配置操作说明。");
      if (config.assigneeMode === "user")
        assertOptionalInteger(
          config.assigneeUserId,
          "操作节点指定处理人必须是有效的内部账号 ID。",
          1,
          Number.MAX_SAFE_INTEGER
        );
      if (config.assigneeMode === "role")
        assertString(
          config.assigneeRoleCode,
          "操作节点按权限角色分配时必须配置角色代号。"
        );
      if (
        ["initiator_manager_n", "sender_manager_n"].includes(
          String(config.assigneeMode)
        )
      )
        assertOptionalInteger(
          config.managerLevel,
          "操作节点主管层级必须是 1 至 32 的整数。",
          1,
          32
        );
      if (
        ["department", "department_manager"].includes(
          String(config.assigneeMode)
        ) &&
        config.assigneeUnitIds !== undefined &&
        !Array.isArray(config.assigneeUnitIds)
      )
        throw new Error("操作节点处理部门必须是 ID 数组。");
      if (
        config.assigneeMode === "department" &&
        (!Array.isArray(config.assigneeUnitIds) ||
          !config.assigneeUnitIds.length)
      )
        throw new Error("操作节点按部门分配时必须至少配置一个部门。");
      if (config.assigneeMode === "form_user")
        assertString(
          config.assigneeFormField,
          "操作节点按表单用户分配时必须配置用户字段。"
        );
      assertOptionalInteger(
        config.formSchemaVersion,
        "操作节点表单版本必须是正整数。",
        1,
        Number.MAX_SAFE_INTEGER
      );
      for (const [value, message] of [
        [config.dueAfterSeconds, "操作节点办理时限必须是非负秒数。"],
        [config.reminderAfterSeconds, "操作节点提醒时间必须是非负秒数。"],
        [config.escalationAfterSeconds, "操作节点升级时间必须是非负秒数。"],
      ] as const)
        assertOptionalInteger(value, message, 0, Number.MAX_SAFE_INTEGER);
      if (config.formSchema !== undefined)
        assertObject(
          config.formSchema,
          "操作节点任务表单 Schema 必须是 JSON 对象。"
        );
      const dueAfterSeconds = Number(config.dueAfterSeconds ?? 0);
      const reminderAfterSeconds = Number(config.reminderAfterSeconds ?? 0);
      const escalationAfterSeconds = Number(config.escalationAfterSeconds ?? 0);
      if (dueAfterSeconds > 0 && reminderAfterSeconds > dueAfterSeconds)
        throw new Error("操作节点提醒时间不能晚于办理时限。");
      if (
        escalationAfterSeconds > 0 &&
        reminderAfterSeconds > 0 &&
        escalationAfterSeconds < reminderAfterSeconds
      )
        throw new Error("操作节点升级时间不能早于提醒时间。");
      if (config.qxkz !== undefined && !Array.isArray(config.qxkz))
        throw new Error("操作节点权限控制必须是数组。");
      if (config.bddx !== undefined && !Array.isArray(config.bddx))
        throw new Error("操作节点绑定对象必须是数组。");
      if (config.outcomes !== undefined && !Array.isArray(config.outcomes))
        throw new Error("操作节点结果出口必须是数组。");
      if (
        config.outcomeMode !== undefined &&
        !["explicit", "legacy_cancel"].includes(String(config.outcomeMode))
      )
        throw new Error("操作节点结果路由模式无效。");
      const outcomes = readOperateOutcomes(config);
      if (config.outcomeMode === "explicit" && !outcomes.length)
        throw new Error("显式结果路由必须至少配置一个结果出口。");
      const outcomeCodes = new Set<string>();
      const outcomeHandles = new Set<string>();
      for (const outcome of outcomes) {
        assertString(outcome.code, "操作结果必须配置结果代号。");
        assertString(outcome.label, "操作结果必须配置显示名称。");
        assertString(outcome.sourceHandle, "操作结果必须配置分支句柄。");
        if (outcomeCodes.has(outcome.code))
          throw new Error("操作结果代号不可重复。");
        if (outcomeHandles.has(outcome.sourceHandle))
          throw new Error("操作结果分支句柄不可重复。");
        outcomeCodes.add(outcome.code);
        outcomeHandles.add(outcome.sourceHandle);
      }
      for (const key of ["bdcz", "sxsz", "fsfsz", "jsfsz", "zdzx"])
        if (config[key] !== undefined)
          assertObject(config[key], "操作节点" + key + "配置必须是对象。");
      const reference = normalizeReferenceOperateConfig(config);
      const bindOperate =
        config.bdcz &&
        typeof config.bdcz === "object" &&
        !Array.isArray(config.bdcz)
          ? (config.bdcz as NodeConfig)
          : {};
      const rawPercent = Number(bindOperate.hqtgbfb);
      if (
        reference.signMode === "andSignFor" &&
        bindOperate.hqtgbfb !== undefined &&
        bindOperate.hqtgbfb !== "" &&
        (!Number.isFinite(rawPercent) || rawPercent <= 0 || rawPercent > 100)
      ) {
        throw new Error("操作节点会签通过百分比必须在 1 至 100 之间。");
      }
      if (reference.autoExecute && reference.hasUnsafeAutoExecuteCode)
        throw new Error(
          "操作节点自动执行代码尚未迁移为安全条件，禁止发布执行。"
        );
      for (const item of reference.autoExecuteConditions) {
        assertObject(item, "操作节点自动执行条件必须是对象。");
        const condition = item as NodeConfig;
        if (condition.left === undefined || condition.operator === undefined)
          throw new Error("操作节点自动执行条件必须配置左值和操作符。");
        if (
          !conditionOperators.some(
            item => item.value === String(condition.operator)
          )
        )
          throw new Error("操作节点自动执行条件操作符无效。");
      }
      break;
    }
    case "router": {
      if (!Array.isArray(config.routes))
        throw new Error("路由节点的路由规则必须是数组。");
      assertString(config.defaultRoute, "路由节点必须配置默认分支。");
      for (const route of config.routes) {
        assertObject(route, "路由节点的路由规则必须是对象。");
        const item = route as NodeConfig;
        // 原始样例使用 code/target；新版面板使用 handle/condition。两种结构均可导入，且不改写原始 JSON。
        assertString(item.handle ?? item.code, "路由规则必须配置分支句柄。");
        const condition = item.condition;
        if (condition !== undefined) {
          assertObject(condition, "路由规则的条件必须是对象。");
          assertString(
            (condition as NodeConfig).left,
            "路由规则条件必须配置左值。"
          );
          if (
            !conditionOperators.some(
              item => item.value === String((condition as NodeConfig).operator)
            )
          )
            throw new Error("路由规则条件操作符无效。");
        }
      }
      if (
        Array.isArray(config.lysz) &&
        config.lysz.length > 0 &&
        config.routes.length === 0
      ) {
        const legacyRouter = normalizeReferenceRouterConfig(config);
        if (legacyRouter.hasUnsafeCode)
          throw new Error(
            "路由节点包含原版任意代码，必须迁移为安全路由规则后才能执行。"
          );
        if (legacyRouter.rules.some(rule => !rule.targetNodeId))
          throw new Error("原版路由规则缺少目标节点，无法安全迁移。");
      }
      break;
    }
    case "rest":
    case "method":
    case "http": {
      const referenceType =
        type === "method" ? "方法" : type === "rest" ? "REST" : "HTTP";
      assertString(
        type === "http"
          ? config.url
          : firstNonBlank(config.restApi, config.endpoint, config.url),
        `${referenceType} 节点必须配置请求地址。`
      );
      if (
        config.endpointRef !== undefined &&
        config.endpointRef !== "" &&
        !/^[A-Z][A-Z0-9_]{1,63}$/.test(String(config.endpointRef))
      )
        throw new Error(`${referenceType} 节点 EndpointRef 格式无效。`);
      if (
        config.secretRef !== undefined &&
        config.secretRef !== "" &&
        !/^env:FLOW_SECRET_[A-Z0-9_]{2,128}$/.test(String(config.secretRef))
      )
        throw new Error(`${referenceType} 节点 SecretRef 格式无效。`);
      const configuredUrl = String(
        type === "http"
          ? config.url
          : firstNonBlank(config.restApi, config.endpoint, config.url)
      );
      if (
        config.endpointRef &&
        /^[a-z][a-z0-9+.-]*:/i.test(configuredUrl)
      )
        throw new Error(
          `${referenceType} 节点使用 EndpointRef 时只能配置相对路径。`
        );
      const method =
        type === "http"
          ? config.method
          : firstNonBlank(config.restType, config.method);
      if (
        !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(
          String(method).toUpperCase()
        )
      )
        throw new Error(`${referenceType} 节点请求方法不受支持。`);
      const headers =
        type === "http"
          ? config.headers
          : (config.restHeaderParam ?? config.headers);
      if (headers !== undefined && !Array.isArray(headers))
        assertObject(
          headers,
          `${referenceType} 节点请求头必须是键值项数组或 JSON 对象。`
        );
      assertOptionalNumber(
        config.timeout,
        `${referenceType} 节点超时必须在 1,000 至 15,000 毫秒之间。`,
        1_000,
        15_000
      );
      if (
        config.writeSafety !== undefined &&
        !["unconfigured", "idempotent", "compensated"].includes(
          String(config.writeSafety)
        )
      )
        throw new Error(`${referenceType} 节点写操作安全策略无效。`);
      if (config.writeSafety === "compensated")
        assertString(
          config.compensationNodeId,
          `${referenceType} 节点补偿策略必须配置补偿节点 ID。`
        );
      for (const [value, message, min, max] of [
        [config.retryMaxAttempts, `${referenceType} 节点最大尝试次数必须是 1 至 5 的整数。`, 1, 5],
        [config.retryBaseDelayMs, `${referenceType} 节点重试延迟必须是 50 至 5,000 毫秒的整数。`, 50, 5_000],
        [config.circuitFailureThreshold, `${referenceType} 节点熔断阈值必须是 1 至 20 的整数。`, 1, 20],
        [config.circuitResetMs, `${referenceType} 节点熔断恢复时间必须是 1,000 至 300,000 毫秒的整数。`, 1_000, 300_000],
        [config.concurrencyLimit, `${referenceType} 节点并发上限必须是 1 至 50 的整数。`, 1, 50],
      ] as const)
        assertOptionalInteger(value, message, min, max);
      const attributes =
        config.restAttributeMap &&
        typeof config.restAttributeMap === "object" &&
        !Array.isArray(config.restAttributeMap)
          ? (config.restAttributeMap as NodeConfig)
          : {};
      if (
        type !== "http" &&
        (hasMeaningfulLegacyValue(config.restScriptCode) ||
          attributes.valid === true ||
          attributes.valid === "true")
      ) {
        throw new Error(
          `${referenceType} 节点启用了尚未隔离迁移的原版响应校验脚本，当前禁止执行。`
        );
      }
      break;
    }
    case "form": {
      if (!Array.isArray(config.fields))
        throw new Error("表单节点字段必须是数组。");
      const keys = new Set<string>();
      for (const field of config.fields) {
        assertObject(field, "表单字段必须是对象。");
        const item = field as NodeConfig;
        assertString(item.key, "表单字段必须配置 key。");
        // 历史定义只提供 key/required；字段化面板将其显示为 key + text，不能因此阻止运行。
        if (item.label !== undefined)
          assertString(item.label, "表单字段必须配置标签。");
        if (item.type !== undefined)
          assertString(item.type, "表单字段必须配置类型。");
        if (item.required !== undefined && typeof item.required !== "boolean")
          throw new Error("表单字段 required 必须是布尔值。");
        if (keys.has(item.key as string))
          throw new Error("表单字段 key 不可重复。");
        keys.add(item.key as string);
      }
      break;
    }
    case "sql":
      assertString(config.datasourceId, "SQL 节点必须选择数据源。");
      assertString(
        firstNonBlank(config.statement, config.sql, config.query),
        "SQL 节点必须配置 SQL 语句。"
      );
      break;
    case "transform":
      assertObject(config.mappings, "转换节点的字段映射必须是 JSON 对象。");
      break;
    case "condition":
      assertString(config.left, "条件节点必须配置左值。");
      if (
        !conditionOperators.some(item => item.value === String(config.operator))
      )
        throw new Error("条件节点操作符无效。");
      assertString(config.trueHandle, "条件节点必须配置成立分支句柄。");
      assertString(config.falseHandle, "条件节点必须配置不成立分支句柄。");
      break;
    case "llm":
      assertString(config.systemPrompt, "LLM 节点必须配置系统提示词。");
      assertString(
        config.prompt ?? config.userPrompt,
        "LLM 节点必须配置提示词。"
      );
      assertOptionalNumber(
        config.maxTokens,
        "LLM 节点最大输出令牌必须在 64 至 8,192 之间。",
        64,
        8_192
      );
      assertOptionalNumber(
        config.timeoutMs,
        "LLM 节点超时必须在 1,000 至 120,000 毫秒之间。",
        1_000,
        120_000
      );
      if (config.outputSchema !== undefined) {
        assertObject(
          config.outputSchema,
          "LLM 节点结构化输出 Schema 必须是对象。"
        );
        const outputSchema = config.outputSchema as NodeConfig;
        assertString(
          outputSchema.name,
          "LLM 节点结构化输出 Schema 必须配置 name。"
        );
        assertObject(
          outputSchema.schema,
          "LLM 节点结构化输出 Schema 必须配置 schema 对象。"
        );
        if (
          outputSchema.strict !== undefined &&
          typeof outputSchema.strict !== "boolean"
        )
          throw new Error("LLM 节点结构化输出 Schema 的 strict 必须是布尔值。");
      }
      if (config.failureHandle !== undefined && config.failureHandle !== "")
        assertString(
          config.failureHandle,
          "LLM 节点失败分支句柄必须是字符串。"
        );
      break;
    case "subflow":
      assertString(
        firstNonBlank(config.subflowId),
        "子流程节点必须选择有效的当前子流程映射。"
      );
      if (
        config.executionMode !== undefined &&
        config.executionMode !== "sync_snapshot"
      )
        throw new Error("子流程当前仅支持同步固定快照模式。");
      break;
    case "source":
    case "table":
      assertString(config.assetId, "资源节点必须选择项目数据资源。");
      break;
    case "filter":
      assertString(config.filterField, "筛选节点必须配置筛选字段。");
      break;
    case "map":
      if (!Array.isArray(config.columns))
        throw new Error("字段映射节点 columns 必须是数组。");
      assertOptionalNumber(
        config.limit,
        "字段映射节点行数限制必须为正数。",
        1,
        100_000
      );
      break;
    case "edit_sql":
      assertString(config.sql, "SQL 编辑节点必须配置 SQL 语句。");
      break;
    case "udf":
      assertString(config.udfId, "UDF 节点必须选择项目函数。");
      break;
    case "sink":
    case "output":
      assertString(config.outputName, "输出节点必须配置输出名称。");
      break;
  }
}
