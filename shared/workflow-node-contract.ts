export type FlowType = "state" | "control" | "data";

export const FLOW_NODE_TYPES = [
  "start", "end", "transform", "condition", "http", "llm", "subflow",
  "state", "operate", "router", "rest", "form", "sql", "source", "table",
  "filter", "map", "udf", "sink", "output", "edit_sql",
] as const;

export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];
export type NodeConfig = Record<string, unknown>;

export type NodeField = {
  key: string;
  label: string;
  help: string;
  required?: boolean;
  kind: "text" | "textarea" | "number" | "select" | "json" | "template";
  options?: Array<{ value: string; label: string }>;
};

export type FlowNodeDefinition = {
  type: FlowNodeType;
  label: string;
  description: string;
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

const templateHelp = "支持 {{input.field}}、{{vars.field}} 与 {{nodes.节点ID.字段}}，不执行任意表达式。";

export const FLOW_NODE_DEFINITIONS: Record<FlowNodeType, FlowNodeDefinition> = {
  start: {
    type: "start", label: "开始", description: "初始化流程输入变量", flowTypes: ["state", "control", "data"],
    defaultConfig: { initialVariables: {} },
    fields: [{ key: "initialVariables", label: "初始变量", help: "流程启动时写入 vars 的 JSON 对象。", kind: "json", required: true }],
  },
  end: {
    type: "end", label: "结束", description: "输出最终运行结果", flowTypes: ["state", "control", "data"],
    defaultConfig: { resultTemplate: "{{vars}}" },
    fields: [{ key: "resultTemplate", label: "结果模板", help: templateHelp, kind: "template", required: true }],
  },
  state: {
    type: "state", label: "状态节点", description: "记录业务或系统状态", flowTypes: ["state", "control"],
    defaultConfig: { stateCode: "STATE_CODE", displayName: "业务状态", stateType: "business" },
    fields: [
      { key: "stateCode", label: "状态代号", help: "用于状态流识别和审计的稳定代码。", kind: "text", required: true },
      { key: "displayName", label: "状态名称", help: "面向流程设计者和实例查看者的显示名称。", kind: "text", required: true },
      { key: "stateType", label: "状态类型", help: "区分业务状态和系统状态。", kind: "select", options: [{ value: "business", label: "业务状态" }, { value: "system", label: "系统状态" }], required: true },
    ],
  },
  operate: {
    type: "operate", label: "操作节点", description: "创建可领取、可审计的人工操作", flowTypes: ["state", "control"],
    defaultConfig: { commandCode: "COMMAND_CODE", assigneeMode: "role", instruction: "请完成此项流程操作。" },
    fields: [
      { key: "commandCode", label: "操作代号", help: "用于审计和业务系统映射的操作代码。", kind: "text", required: true },
      { key: "assigneeMode", label: "处理人方式", help: "按角色、指定用户、发起人或无人指定创建待办。", kind: "select", required: true, options: [{ value: "role", label: "角色" }, { value: "user", label: "指定用户" }, { value: "initiator", label: "发起人" }, { value: "none", label: "不指定" }] },
      { key: "instruction", label: "操作说明", help: templateHelp, kind: "textarea", required: true },
      { key: "assigneeUserId", label: "指定处理人 ID", help: "仅“指定用户”方式需要；必须为可用内部账号。", kind: "number" },
    ],
  },
  router: {
    type: "router", label: "路由节点", description: "按分支规则选择后继连线", flowTypes: ["control"],
    defaultConfig: { routes: [], defaultRoute: "default" },
    fields: [
      { key: "routes", label: "路由规则", help: "按顺序匹配；每项包含 handle、label 及可选 condition（left、operator、right）。", kind: "json", required: true },
      { key: "defaultRoute", label: "默认分支", help: "未命中规则时使用的连线句柄；应与画布连线的源句柄一致。", kind: "text", required: true },
    ],
  },
  rest: {
    type: "rest", label: "REST 节点", description: "通过受限网络策略调用外部 REST 服务", flowTypes: ["control", "data"],
    defaultConfig: { endpoint: "", method: "POST", headers: {}, body: {}, timeout: 15000 },
    fields: [
      { key: "endpoint", label: "请求地址", help: `${templateHelp} 服务端拒绝本机、私有网段、凭据 URL 与非标准端口。`, kind: "template", required: true },
      { key: "method", label: "请求方法", help: "支持 GET、POST、PUT、PATCH、DELETE。", kind: "select", required: true, options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map(value => ({ value, label: value })) },
      { key: "headers", label: "请求头", help: "JSON 对象；Host、Connection 与 Content-Length 会被服务端剔除。", kind: "json" },
      { key: "body", label: "请求体", help: templateHelp, kind: "json" },
      { key: "timeout", label: "超时（毫秒）", help: "服务端限制为 1,000 至 15,000 毫秒。", kind: "number" },
    ],
  },
  form: {
    type: "form", label: "表单节点", description: "定义流程实例需要提交的字段", flowTypes: ["state", "control"],
    defaultConfig: { fields: [] },
    fields: [{ key: "fields", label: "表单字段", help: "数组项包含 key、label、type、required，可选 placeholder、defaultValue、options。", kind: "json", required: true }],
  },
  sql: {
    type: "sql", label: "SQL 节点", description: "数据流程只读 SQL 计划", flowTypes: ["data"],
    defaultConfig: { datasourceId: "", statement: "SELECT * FROM source", parameters: {} },
    fields: [
      { key: "datasourceId", label: "数据源", help: "引用项目内的数据源标识，不暴露连接凭据。", kind: "text", required: true },
      { key: "statement", label: "SQL 语句", help: "仅允许单条只读查询；不允许 DDL、DML 或多语句。", kind: "textarea", required: true },
      { key: "parameters", label: "参数", help: "供 SQL 模板或数据流执行器使用的 JSON 参数对象。", kind: "json" },
    ],
  },
  transform: {
    type: "transform", label: "转换", description: "将模板化字段映射为新的节点输出", flowTypes: ["state", "control", "data"],
    defaultConfig: { mappings: {} },
    fields: [{ key: "mappings", label: "字段映射", help: templateHelp, kind: "json", required: true }],
  },
  condition: {
    type: "condition", label: "条件", description: "选择 true 或 false 分支", flowTypes: ["state", "control", "data"],
    defaultConfig: { left: "{{input.value}}", operator: "equals", right: true, trueHandle: "true", falseHandle: "false" },
    fields: [
      { key: "left", label: "左值", help: templateHelp, kind: "template", required: true },
      { key: "operator", label: "比较方式", help: "使用严格比较、包含、存在或数值比较。", kind: "select", required: true, options: conditionOperators },
      { key: "right", label: "右值", help: "可使用 JSON 标量或模板。", kind: "json" },
      { key: "trueHandle", label: "成立分支句柄", help: "匹配时选择的源句柄。", kind: "text", required: true },
      { key: "falseHandle", label: "不成立分支句柄", help: "不匹配时选择的源句柄。", kind: "text", required: true },
    ],
  },
  llm: {
    type: "llm", label: "LLM", description: "调用运行时可用模型目录", flowTypes: ["state", "control", "data"],
    defaultConfig: { model: "", systemPrompt: "你是一名严谨的工作流助手。", prompt: "{{input.prompt}}", maxTokens: 1024 },
    fields: [
      { key: "model", label: "模型", help: "从运行时模型目录选择；未指定或不可用时使用目录中的可用模型。", kind: "text" },
      { key: "systemPrompt", label: "系统提示词", help: templateHelp, kind: "textarea", required: true },
      { key: "prompt", label: "用户提示词", help: templateHelp, kind: "textarea", required: true },
      { key: "maxTokens", label: "最大输出令牌", help: "服务端限制为 64 至 8,192。", kind: "number" },
    ],
  },
  subflow: {
    type: "subflow", label: "子流程", description: "调用当前所有者的可复用私有流程", flowTypes: ["state", "control", "data"],
    defaultConfig: { subflowId: "", input: "{{input}}" },
    fields: [
      { key: "subflowId", label: "子流程", help: "必须选择当前流程所有者已启用的私有子流程。", kind: "text", required: true },
      { key: "input", label: "传入数据", help: templateHelp, kind: "json" },
    ],
  },
  http: {
    type: "http", label: "HTTP", description: "受限外部请求的兼容节点", flowTypes: ["state", "control", "data"],
    defaultConfig: { method: "GET", url: "", headers: {}, body: {}, timeout: 15000 },
    fields: [
      { key: "url", label: "请求地址", help: "兼容节点；使用与 REST 节点相同的 SSRF 防护。", kind: "template", required: true },
      { key: "method", label: "请求方法", help: "支持 GET、POST、PUT、PATCH、DELETE。", kind: "select", required: true, options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map(value => ({ value, label: value })) },
      { key: "headers", label: "请求头", help: "JSON 对象。", kind: "json" },
      { key: "body", label: "请求体", help: templateHelp, kind: "json" },
      { key: "timeout", label: "超时（毫秒）", help: "服务端限制为 1,000 至 15,000 毫秒。", kind: "number" },
    ],
  },
  source: { type: "source", label: "资源", description: "引用项目内已探查的数据资源", flowTypes: ["data"], defaultConfig: { assetId: "" }, fields: [{ key: "assetId", label: "资源", help: "项目隔离的数据资源标识。", kind: "text", required: true }] },
  table: { type: "table", label: "中间表", description: "读取项目资源或中间数据集", flowTypes: ["data"], defaultConfig: { assetId: "" }, fields: [{ key: "assetId", label: "中间表或资源", help: "项目隔离的资源标识。", kind: "text", required: true }] },
  filter: { type: "filter", label: "筛选", description: "按字段和值筛选样本行", flowTypes: ["data"], defaultConfig: { filterField: "", filterValue: "" }, fields: [{ key: "filterField", label: "筛选字段", help: "要比较的输出字段名称。", kind: "text", required: true }, { key: "filterValue", label: "筛选值", help: templateHelp, kind: "template" }] },
  map: { type: "map", label: "字段映射", description: "选择输出字段并限制行数", flowTypes: ["data"], defaultConfig: { columns: [], limit: 200 }, fields: [{ key: "columns", label: "输出字段", help: "字段名数组；留空可保留输入字段。", kind: "json" }, { key: "limit", label: "最大行数", help: "限制数据流输出行数。", kind: "number" }] },
  edit_sql: { type: "edit_sql", label: "SQL", description: "数据流 SQL 编辑节点", flowTypes: ["data"], defaultConfig: { sql: "SELECT * FROM source" }, fields: [{ key: "sql", label: "SQL", help: "仅允许单条只读查询。", kind: "textarea", required: true }] },
  udf: { type: "udf", label: "UDF", description: "引用已审核的项目函数元数据", flowTypes: ["data"], defaultConfig: { udfId: "" }, fields: [{ key: "udfId", label: "UDF", help: "项目隔离且已审核的 UDF 标识。", kind: "text", required: true }] },
  sink: { type: "sink", label: "输出", description: "将数据流结果输出到运行审计", flowTypes: ["data"], defaultConfig: { outputName: "result" }, fields: [{ key: "outputName", label: "输出名称", help: "数据流运行审计中的输出引用名称。", kind: "text", required: true }] },
  output: { type: "output", label: "输出", description: "兼容输出节点", flowTypes: ["data"], defaultConfig: { outputName: "result" }, fields: [{ key: "outputName", label: "输出名称", help: "数据流运行审计中的输出引用名称。", kind: "text", required: true }] },
};

export function isFlowNodeType(value: unknown): value is FlowNodeType {
  return typeof value === "string" && (FLOW_NODE_TYPES as readonly string[]).includes(value);
}

export function createDefaultNodeConfig(type: FlowNodeType): NodeConfig {
  return structuredClone(FLOW_NODE_DEFINITIONS[type].defaultConfig);
}

/** Preserves forward-compatible keys while filling only missing documented defaults. */
export function withNodeConfigDefaults(type: FlowNodeType, config: NodeConfig): NodeConfig {
  return Object.entries(config).reduce<NodeConfig>((merged, [key, value]) => {
    if (value !== undefined) merged[key] = value;
    return merged;
  }, createDefaultNodeConfig(type));
}

function assertObject(value: unknown, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
}

function assertString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
}

function assertOptionalNumber(value: unknown, message: string, min: number, max: number) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(message);
}

/** Validates documented properties without deleting unknown keys from an imported historical definition. */
export function validateNodeConfig(type: FlowNodeType, config: NodeConfig) {
  switch (type) {
    case "start": assertObject(config.initialVariables, "开始节点的初始变量必须是 JSON 对象。"); break;
    case "end": {
      const template = config.resultTemplate;
      if (template === undefined || template === null || (typeof template === "string" && !template.trim())) throw new Error("结束节点必须配置结果模板。");
      break;
    }
    case "state": assertString(config.stateCode, "状态节点必须配置状态代号。"); assertString(config.displayName, "状态节点必须配置状态名称。"); break;
    case "operate": {
      assertString(config.commandCode, "操作节点必须配置操作代号。");
      if (!['role', 'user', 'initiator', 'none'].includes(String(config.assigneeMode))) throw new Error("操作节点处理人方式无效。");
      assertString(config.instruction, "操作节点必须配置操作说明。");
      if (config.assigneeMode === "user") assertOptionalNumber(config.assigneeUserId, "操作节点指定处理人必须是有效的内部账号 ID。", 1, Number.MAX_SAFE_INTEGER);
      break;
    }
    case "router": {
      if (!Array.isArray(config.routes)) throw new Error("路由节点的路由规则必须是数组。");
      assertString(config.defaultRoute, "路由节点必须配置默认分支。");
      for (const route of config.routes) {
        assertObject(route, "路由节点的路由规则必须是对象。");
        const item = route as NodeConfig;
        // 原始样例使用 code/target；新版面板使用 handle/condition。两种结构均可导入，且不改写原始 JSON。
        assertString(item.handle ?? item.code, "路由规则必须配置分支句柄。");
        const condition = item.condition;
        if (condition !== undefined) {
          assertObject(condition, "路由规则的条件必须是对象。");
          assertString((condition as NodeConfig).left, "路由规则条件必须配置左值。");
          if (!conditionOperators.some(item => item.value === String((condition as NodeConfig).operator))) throw new Error("路由规则条件操作符无效。");
        }
      }
      break;
    }
    case "rest": case "http": {
      assertString(type === "rest" ? config.endpoint : config.url, `${type === "rest" ? "REST" : "HTTP"} 节点必须配置请求地址。`);
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(config.method).toUpperCase())) throw new Error(`${type === "rest" ? "REST" : "HTTP"} 节点请求方法不受支持。`);
      if (config.headers !== undefined) assertObject(config.headers, `${type === "rest" ? "REST" : "HTTP"} 节点请求头必须是 JSON 对象。`);
      assertOptionalNumber(config.timeout, `${type === "rest" ? "REST" : "HTTP"} 节点超时必须在 1,000 至 15,000 毫秒之间。`, 1_000, 15_000);
      break;
    }
    case "form": {
      if (!Array.isArray(config.fields)) throw new Error("表单节点字段必须是数组。");
      const keys = new Set<string>();
      for (const field of config.fields) {
        assertObject(field, "表单字段必须是对象。");
        const item = field as NodeConfig;
        assertString(item.key, "表单字段必须配置 key。");
        // 历史定义只提供 key/required；字段化面板将其显示为 key + text，不能因此阻止运行。
        if (item.label !== undefined) assertString(item.label, "表单字段必须配置标签。");
        if (item.type !== undefined) assertString(item.type, "表单字段必须配置类型。");
        if (item.required !== undefined && typeof item.required !== "boolean") throw new Error("表单字段 required 必须是布尔值。");
        if (keys.has(item.key as string)) throw new Error("表单字段 key 不可重复。"); keys.add(item.key as string);
      }
      break;
    }
    case "sql": assertString(config.datasourceId, "SQL 节点必须选择数据源。"); assertString(config.statement, "SQL 节点必须配置 SQL 语句。"); break;
    case "transform": assertObject(config.mappings, "转换节点的字段映射必须是 JSON 对象。"); break;
    case "condition": assertString(config.left, "条件节点必须配置左值。"); if (!conditionOperators.some(item => item.value === String(config.operator))) throw new Error("条件节点操作符无效。"); assertString(config.trueHandle, "条件节点必须配置成立分支句柄。"); assertString(config.falseHandle, "条件节点必须配置不成立分支句柄。"); break;
    case "llm": assertString(config.systemPrompt, "LLM 节点必须配置系统提示词。"); assertString(config.prompt ?? config.userPrompt, "LLM 节点必须配置提示词。"); assertOptionalNumber(config.maxTokens, "LLM 节点最大输出令牌必须在 64 至 8,192 之间。", 64, 8_192); break;
    case "subflow": assertString(config.subflowId, "子流程节点必须选择有效的子流程。"); break;
    case "source": case "table": assertString(config.assetId, "资源节点必须选择项目数据资源。"); break;
    case "filter": assertString(config.filterField, "筛选节点必须配置筛选字段。"); break;
    case "map": if (!Array.isArray(config.columns)) throw new Error("字段映射节点 columns 必须是数组。"); assertOptionalNumber(config.limit, "字段映射节点行数限制必须为正数。", 1, 100_000); break;
    case "edit_sql": assertString(config.sql, "SQL 编辑节点必须配置 SQL 语句。"); break;
    case "udf": assertString(config.udfId, "UDF 节点必须选择项目函数。"); break;
    case "sink": case "output": assertString(config.outputName, "输出节点必须配置输出名称。"); break;
  }
}
