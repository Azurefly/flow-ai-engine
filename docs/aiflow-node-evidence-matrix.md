# AiFlowGraph 节点字段证据矩阵

## 证据范围与判定规则

当前可访问的 `design_process.html` 可直接证明状态/控制画布工具栏中存在 **开始、结束、状态、操作、路由、子流程、REST、SQL** 以及禁用的业务资源、物理资源入口。该 HTML 引用了 `assets/js/designProcess/bundle.js` 与画布相关脚本，但这些打包资源并未保留在裁剪副本中。因此，任何无法从 HTML、保留脚本或唯一历史控制器逐字段定位的属性名称、默认值、帮助文本和校验，均明确标为 **兼容扩展**，而非声称是原始安装包字段。

> 当前实现将所有节点的可编辑字段集中于 `shared/workflow-node-contract.ts`。该契约同时被画布检查器、草稿校验、发布前严格校验、导入导出兼容和后端执行器消费，避免仅复刻节点外观而失去定义与执行闭环。

| 证据等级 | 含义 | 当前处理 |
|---|---|---|
| 原始可见 | 可由静态 HTML/保留脚本直接确认节点或入口存在。 | 保留对应工具栏、页面文案和可见状态。 |
| 历史接口线索 | 唯一 `FlowController.java` 可确认状态、操作、模板或历史流程概念。 | 以资源级权限、审计和内部账号安全映射实现。 |
| 兼容扩展 | 字段或默认值没有可访问 bundle 证据。 | 在节点契约明确说明，采用安全最小默认值并纳入测试。 |

## 节点—字段—执行映射

| 节点类型 | 原始节点/入口证据 | 当前字段、默认值及帮助来源 | 服务端定义/执行映射 | 证据结论 |
|---|---|---|---|---|
| `start` | `start-node`，文案“开始”。 | `initialVariables: {}`；启动时写入变量。 | `validateNodeConfig` + `workflow-engine` 启动输出。 | 节点为原始可见；字段为兼容扩展。 |
| `end` | `end-node`，文案“结束”。 | `resultTemplate: "{{vars}}"`；模板输出。 | 定义校验、对象型历史模板兼容、执行最终输出。 | 节点为原始可见；字段为兼容扩展。 |
| `state` | `basic-node`，文案“状态节点”。 | `stateCode`、`displayName`、`stateType`。 | 草稿/发布校验，状态运行审计。 | 节点为原始可见；字段受历史状态接口线索支持，其余为兼容扩展。 |
| `operate` | `operate-node`，文案“操作节点”。 | `commandCode`、`assigneeMode`、`instruction`、`assigneeUserId`。 | 创建人工任务、领取、移交、退回、批量完成与服务端续跑。 | 节点为原始可见；任务概念受历史接口线索支持；字段为兼容扩展。 |
| `router` | `route-node`，文案“路由节点”。 | `routes`、`defaultRoute`。 | `selectRouterRoute` 只选择匹配句柄后继边；兼容历史 `code/target`。 | 节点为原始可见；字段为兼容扩展。 |
| `subflow` | `subprocess-node`，文案“子流程”。 | `subflowId`、`input`。 | 所有者私有子流程校验、禁止嵌套、可审计执行输入输出。 | 节点为原始可见；字段为兼容扩展。 |
| `rest` | `rest-node`，文案“REST节点”。 | `endpoint`、`method`、`headers`、`body`、`timeout`。 | 模板解析、协议/DNS/私网/端口/重定向限制、响应大小限制。 | 节点为原始可见；字段为兼容扩展。 |
| `sql` | `sql-node`，原始控制画布中禁用。 | `datasourceId`、`statement`、`parameters`。 | 数据流程只读 SQL 约束；控制画布不运行。 | 节点/禁用状态为原始可见；字段为兼容扩展。 |
| `form` | 无保留 bundle 字段证据。 | `fields`（`key`、`label`、`type`、`required` 等）。 | 定义校验与历史简写表单导入兼容。 | 兼容扩展。 |
| `transform` | 无保留 bundle 字段证据。 | `mappings: {}`。 | 模板映射输出至节点上下文。 | 兼容扩展。 |
| `condition` | 无保留 bundle 字段证据。 | `left`、`operator`、`right`、`trueHandle`、`falseHandle`。 | 严格比较/存在性判断及句柄分派。 | 兼容扩展。 |
| `llm` | 无保留 bundle 字段证据。 | `model`、`systemPrompt`、`prompt`、`maxTokens`。 | 运行时模型目录选择，不硬编码模型名。 | 兼容扩展。 |
| `http` | 未在状态/控制工具栏直接出现；与 REST 兼容。 | `url`、`method`、`headers`、`body`、`timeout`。 | 与 REST 相同 SSRF 安全边界。 | 兼容扩展。 |
| `source` / `table` | 数据流页面可见资源树和中间表入口。 | `assetId`。 | P2 项目隔离数据资源引用。 | 入口为原始可见；字段为兼容扩展。 |
| `filter` | 无保留 bundle 字段证据。 | `filterField`、`filterValue`。 | P2 数据流行过滤。 | 兼容扩展。 |
| `map` | 数据流页面可见映射类工具入口。 | `columns`、`limit`。 | P2 数据流字段投影与行数限制。 | 入口为原始可见；字段为兼容扩展。 |
| `edit_sql` | 数据流页面可见 SQL 工具。 | `sql`。 | P2 只读 SQL 计划。 | 入口为原始可见；字段为兼容扩展。 |
| `udf` | 数据流页面可见函数树。 | `udfId`。 | 已审核、项目隔离 UDF 元数据引用。 | 入口为原始可见；字段为兼容扩展。 |
| `sink` / `output` | 数据流页面可见运行输出/任务详情概念。 | `outputName`。 | P2 运行审计输出引用。 | 兼容扩展。 |

## 默认值、帮助与校验的代码回链

| 消费面 | 唯一来源 | 已验证内容 |
|---|---|---|
| 属性检查器与节点新增 | `FLOW_NODE_DEFINITIONS`、`createDefaultNodeConfig` | 字段标签、帮助、类型、默认值及红/蓝/绿配置状态。 |
| 草稿、发布、导入 | `withNodeConfigDefaults`、`validateNodeConfig`、`workflow-service.validate` | 草稿允许未完整配置；发布和可执行定义严格阻断；保留未知历史字段。 |
| 数据库定义回读/版本化 | `workflow-definition-persistence.integration.test.ts` | 开始、状态、操作、路由、REST、表单、转换、条件、LLM、子流程、HTTP、结束的保存、重读、导出与复制。 |
| 安全执行 | `workflow-engine.ts`、`workflow-engine*.test.ts`、`project-original-flow.integration.test.ts` | 初始变量、对象结束模板、路由句柄、SSRF 拒绝、人工续跑、子流程和 LLM 运行时目录。 |
| 数据流执行 | `p2-resource-dataflow.integration.test.ts` | 项目隔离资源、只读 SQL、数据流节点、审计和调度。 |

## 需要完整归档后复核的项目

完整 `AiFlowGraph.zip` 或缺失的 `bundle.js`、`canvas.js` 到位后，必须逐字段对照本矩阵并调整 `configEvidence`：只有获得具体表单模板、默认值或校验函数的字段才能从“兼容扩展”提升为“原始确认”。在此之前，当前系统不会把兼容字段误称为原始安装包定义。
