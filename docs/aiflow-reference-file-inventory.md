# AiFlowGraph 参考安装包与后端源码审计清单

## 审计结论

截至 2026-08-22，原安装包已在不修改压缩包的前提下完整展开到：

`D:\潘素金\Coding\AiFlowGraph\参考安装包\解压内容_只读分析`

当前可成功枚举至少 **2,113 个文件**，其中包含 137 个 HTML、615 个 JavaScript、130 个 CSS、89 个模板、324 个 PNG、61 个 SVG 和 432 个 JAR。少量异常长路径或归档中的特殊路径会使 Windows PowerShell 递归枚举产生读取告警，因此此数字用于证明“完整核心包已到位”，不作为归档完整性的唯一校验值。

用户授权的原后端 `FlowEnginServer` 已克隆到：

`D:\潘素金\Coding\AiFlowGraph\参考安装包\FlowEnginServer-dev`

参考分支为 `dev`，审计时提交为 `27339c1`。该目录和原安装包均不纳入当前产品仓库提交，只作为只读契约证据。

> 证据规则：原安装包页面、脚本、模板和原后端类型/反序列化代码可以证明字段与持久化结构；当前系统仍必须保留内部认证、项目隔离、SSRF、只读 SQL、审计和权限边界。原版任意 Java/脚本不能未经隔离直接执行。

## 1. 核心前端证据

核心前端位于：

`FlowEngineService3.3.0\展开\NebulaBS_App_FlowEngineService-install-3.3.0\packages\展开\ComponentService_FrontEnd\NebulaBS_App_ComponentService_FrontEnd-install\build`

| 文件 | 已确认内容 | 当前映射 |
|---|---|---|
| `views/design_process.html` | 状态/控制流程设计器、节点工具栏、画布工具、图例和配置面板。 | `WorkflowCanvas`。 |
| `views/process_detail.html` | 流程引导、基本信息、真实流程图、已启动流程列表。 | `WorkflowDetailPage` + `WorkflowGovernance`。 |
| `views/initiatedProcess.html` | 已启动流程、待办、日历和动态详情页签。 | `ProcessWorkbench`。 |
| `views/processWarehouse.html` | 树形仓库、批量操作、流程简介和只读预览。 | `WorkflowWarehouse`。 |
| `views/dataFlowCanvas.html` | 数据资源/函数树、数据流画布、任务和调度入口。 | `DataResourceCenter`。 |
| `views/dataflow_process_detail.html` | 数据流详情与操作记录。 | 数据流运行审计区。 |
| `views/system_config.html` | 系统配置左栏和动态卡片页签。 | `SystemConfigShell`。 |
| `assets/js/canvas/canvas.js` | 原生节点类型、节点创建默认值和配置初始化。 | `shared/workflow-node-contract.ts`。 |
| `assets/js/designProcess/canvas_operate.js` | 节点配置保存映射。 | 节点配置持久化和执行兼容层。 |
| `assets/template/design_process/configuration-*.tpl` | 各节点属性面板字段和复杂嵌套结构。 | 字段化节点检查器；复杂结构继续逐项迁移。 |

## 2. 原生节点契约

原版确认存在以下节点类型：

| 原版类型 | 当前类型 | 处理状态 |
|---|---|---|
| `START` | `start` | 已保留。 |
| `END` | `end` | 已保留。 |
| `STATE` | `state` | 已恢复原版默认字段并兼容当前字段。 |
| `OPERATE` | `operate` | 已恢复原版默认字段；人工任务使用当前受权限保护的执行路径。 |
| `ROUTER` | `router` | 已恢复原版字段；安全条件 DSL 可执行，原任意代码仅保存。 |
| `REST` | `rest` | 已恢复原版字段并映射到受限 HTTP 执行器。 |
| `METHOD` | `method` | 已补回；原后端证明其与 REST 共用 `RestNode` 结构。 |
| `CHILD` | `subflow` | 已保留原版字段；运行前必须显式映射当前私有子流程。 |
| `SQL` | `sql` | 已保留；继续受只读 SQL 和项目数据源策略限制。 |

`FlowNodeType.java` 明确声明 `METHOD("method", "RestNode", "方法节点")`，`FlowNodeDeserializer.java` 将 `METHOD` 反序列化为 `RestNode`。因此方法节点不是产品扩展，而是此前遗漏的原生节点。

## 3. 原版 REST/方法执行映射

已确认并保留：`nodeDh`、`restmc`、`restType`、`restApi`、`restHeaderParam`、`restGetBodyParam`、`restJsonParam`、`restAttributeMap`、`restScriptCode`。

当前执行器执行前进行以下安全转换：

- `restApi` → URL，仍执行协议、凭据、端口、DNS/IP、私网/环回限制。
- `restType` → HTTP 方法。
- `restHeaderParam` 键值数组 → 请求头对象，并剔除 Host、Connection、Content-Length。
- `restGetBodyParam` 与 `restAttributeMap.restEntryParam` → URL 查询参数。
- `restJsonParam` → JSON 请求体；无效 JSON 保留为文本。
- 继续限制超时、重定向和 1 MB 响应大小。

`restScriptCode` 和原版任意校验代码只做无损保存，当前不会在服务端主进程直接执行。

## 4. 页面恢复现状

| 页面能力 | 当前状态 | 仍需补齐 |
|---|---|---|
| 流程详情顺序 | 已按“流程引导 → 基本信息 → 实际只读画布 → 已启动流程列表 → 版本治理”恢复。 | 真实浏览器会话中的视觉与工具验收。 |
| 设计器节点 | 已补回方法节点、布尔字段、历史字段别名和 REST/GET 键值行编辑。 | 操作权限、路由设置等复杂结构的专用表单。 |
| 仓库/工作台/系统配置 | 已有受权限保护的对应页面和回归测试。 | 逐页浏览器验收及剩余细节对齐。 |
| 数据流 | 已有资源、调度、运行和审计基线。 | 原版专用节点与“继续执行/手动停止”等状态机。 |

## 5. 仍存在的真实差距

| 差距 | 处理原则 |
|---|---|
| 操作节点 `qxkz`、`bddx`、`bdcz`、发送/接收方等复杂结构 | 继续按原模板拆为字段化表单；不能要求用户直接编辑整块 JSON。 |
| 原路由 `lysz` 中的 Java/脚本条件 | 转换为受限条件 DSL；无法安全等价转换的规则保留原值并阻止执行。 |
| 原子流程 `zlcxz.id` | 必须通过迁移表映射为当前所有者的已启用私有 `subflowId`，不直接信任外部 ID。 |
| `restScriptCode` 响应校验 | 后续只能在资源受限、无网络/文件/凭据访问的隔离执行器中实现。 |
| 原版 CSS/图片和第三方组件 | 可参考视觉层级，但不得为了像素复刻引入不受维护的旧依赖或削弱无障碍性。 |

## 6. 验证入口

- 节点字段契约：`server/workflow-node-contract.test.ts`
- REST/方法映射及 SSRF：`server/workflow-engine.test.ts`
- 页面、节点和详情顺序：`server/workflow-ui-regression.test.ts`
- 当前差距清单：`todo.md`

旧的“只有 23 个裁剪文件、完整 ZIP/bundle/后端源码缺失”结论自本次完整展开和源码克隆后作废。
