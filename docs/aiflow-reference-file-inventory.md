# AiFlowGraph 参考文件审计清单（当前可访问副本）

## 审计结论

当前可访问目录为 `/home/ubuntu/reference-aiflow/original/AiFlowGraph`。2026-08-18 的文件统计结果为：**10 个 HTML、11 个 JavaScript、1 个 Java、0 个 CSS、0 个图片资源**。这与任务上下文早期记录的“341 HTML、1890 JS”不一致，说明当前目录是**裁剪后的参考副本**，不能将其当作完整安装包。

项目共享目录中声明的 `AiFlowGraph.zip` 在当前沙箱文件系统中未找到；全局按文件名检索亦未发现。后续如取得完整归档，必须重新生成本清单并以完整文件清单取代本页。

> 证据规则：只有能够在本表“已读取/已定位文件”中直接找到的字段、文案、菜单和行为，才可称为“原始安装包证据”。无法读取的打包脚本、图片、样式或后端模块只能作为待验证缺口；基于兼容性或产品需要新增的键必须标记为扩展字段。

## 1. 文件类型总览

| 类别 | 当前数量 | 审计用途 | 当前结论 |
|---|---:|---|---|
| HTML | 10 | 页面结构、可见文案、按钮、工具栏、空状态 | 已建立九页工作范围矩阵。 |
| JavaScript | 11 | 动态操作、状态和路由线索 | 仅流程设计中心脚本具有较完整的行为证据。 |
| Java | 1 | 后端/安装基线线索 | 不足以代表完整服务端契约。 |
| CSS | 0 | 布局、色彩、尺寸、交互状态 | 无法从当前副本复原精确视觉样式。 |
| 图片/SVG/GIF | 0 | 原始图标、空状态、品牌资源 | 需使用组件图标和中性空状态替代，不宣称像素级还原。 |

## 2. 页面文件（已读取或已定位）

| 文件 | 角色 | 已提取的原始证据 | 当前 Flow AI Engine 映射 |
|---|---|---|---|
| `backend/src/main/resources/static/views/businessCenter.html` | 业务中心 | 筛选、新增、导入、业务列表。 | `BusinessCenter`。 |
| `.../views/businessOverview.html` | 项目工作区 | 返回入口、业务选择、流程设计/权限配置菜单。 | `ProjectWorkspace`。 |
| `.../views/design_process.html` | 状态流程设计器 | 节点工具栏、禁用资源、画布工具、图例、帮助、配置面板。 | `WorkflowCanvas`。 |
| `.../views/initiatedProcess.html` | 已启动流程 | 左栏、卡片页签、日历、加载遮罩。 | `ProcessWorkbench`。 |
| `.../views/processWarehouse.html` | 流程仓库 | 搜索、批量导入导出、简介、无数据、画布预览工具。 | `WorkflowWarehouse`。 |
| `.../views/process_detail.html` | 流程详情 | 引导、基本信息、只读画布、运行实例列表。 | 待建立等价详情视图。 |
| `.../views/dataFlowCanvas.html` | 数据流画布 | 资源/函数树、工具栏、调度、运行反馈。 | `DataResourceCenter`，尚需逐项 UI 对齐。 |
| `.../views/dataflow_process_detail.html` | 数据流详情 | 引导、基本信息、操作审计表。 | 待建立等价详情视图。 |
| `.../views/system_config.html` | 系统配置 | 左栏、动态页签。 | `SystemConfigShell`。 |
| 其余 1 页 | 辅助/框架页面 | 未进入当前产品恢复范围。 | 待完整归档到位后复核。 |

## 3. 脚本与后端文件

| 文件或目录 | 审计状态 | 可证明内容 | 不可证明内容 |
|---|---|---|---|
| `.../assets/js/processDesign/processDesignCenter.js` | 已读取关键区段 | 新增/详情/设计/发布/取消发布/发起/启动/审核重置/筛选的动作与部分校验。 | 节点属性模板未在该文件中完整可见。 |
| `.../assets/js/systemConfig/systemConfig.js` | 已定位并读取相关片段 | 系统配置与状态枚举交叉线索。 | 完整系统配置表单布局。 |
| `.../assets/js/designProcess/bundle.js` | HTML 引用存在，当前副本未保留 | 设计器确实依赖其打包资源。 | 节点字段、默认值、校验、拖放实现。 |
| `.../assets/js/canvas/canvas.js` | HTML 引用存在，当前副本未保留 | 画布工具的脚本来源。 | 整理、导出、选择等精确实现。 |
| `backend-history/platform/src/main/java/...` | 仅发现 1 个 Java 文件路径 | 历史后端根目录存在。 | 服务端 API、安装参数、数据库和权限完整契约。 |

## 4. 恢复优先级

| 优先级 | 文件/能力 | 原因 | 交付证据 |
|---|---|---|---|
| P0 | `design_process.html`、`process_detail.html`、`processDesignCenter.js` | 用户明确要求开始、结束、路由、REST 和操作节点配置不丢失。 | 节点定义表、持久化/执行测试、已登录浏览器编辑。 |
| P0 | `businessCenter.html`、`businessOverview.html`、`processWarehouse.html` | 顶层工作台与项目工作区是所有流程操作入口。 | 页面状态/权限/路由回归。 |
| P1 | `initiatedProcess.html` | 已启动流程与人工任务直接影响真实实例运行。 | 运行、领取、完成、日历视图测试。 |
| P2 | `dataFlowCanvas.html`、`dataflow_process_detail.html` | 数据资源、调度和审计必须保持项目隔离。 | 资源隔离、只读 SQL、调度闭环测试。 |
| P2 | `system_config.html`、`systemConfig.js` | 设置必须真实被发布门禁、水印和工作域消费。 | 管理员权限、保存后即时消费测试。 |

## 5. 当前阻塞与处理方式

| 缺口 | 风险 | 当前处理 |
|---|---|---|
| 完整 ZIP 不在文件系统 | 无法进行 341 HTML/1890 JS 的逐文件证明。 | 维持本清单为“当前可访问副本”；不伪称完整审计。 |
| 设计器 bundle/canvas 脚本缺失 | 无法证明某些字段为原始默认值。 | 统一节点契约中这些键标为兼容/扩展候选，并用服务端安全校验保护。 |
| CSS 和图片资源缺失 | 无法像素级还原。 | 复原层级、文案、状态和交互；视觉采用现有组件系统。 |
| 后端源码缺失 | 无法复制原服务端权限或数据库实现。 | 以当前内部认证、IAM、多用户隔离和测试为安全基线，不引入外部身份依赖。 |

## 6. 历史流程控制器操作映射（`FlowController.java`）

唯一保留的历史控制器以 `/footstone/flow` 为根路径，可直接证明存在操作执行、查询处理人、创建流程、历史步骤、模板状态/操作维护、任务回退、移交及批量操作等概念；但它未提供用户认证、租户隔离或数据库实现，不能原样复刻为当前服务的安全契约。

| 历史控制器动作 | 证据位置 | 当前安全映射 | 审计结论 |
|---|---|---|---|
| 单项流程操作、操作处理人查询 | `/operate`、`/operate/acceptor` | `task.claim`、`task.complete`、`task.assignees` | 已恢复；仅具备 `workflow:run` 的内部用户可操作或被列为候选。 |
| 操作回退 | `/operate/backoff` | `task.returnToPending` | 已采用“退回待处理、不倒写已完成实例”的受限语义，避免破坏已审计运行。 |
| 操作移交 | `/operate/handover` | `task.handover` | 已恢复；目标用户必须处于 active 状态并拥有相同流程的运行权限。 |
| 批量操作 | `/operate/batch`、`/operate/batch/future` | `task.batchClaim`、`task.batchComplete` | 已恢复为最多 20 项的逐项处理，逐项权限/状态校验并返回成功或失败结果，避免跨项目批量副作用。 |
| 历史步骤、最近步骤、子流程历史 | `/get/history/step`、`/get/lasttime/step` | 运行详情、节点执行日志、子流程节点输入输出审计 | 已以资源级运行日志替代；保留流程运行与节点日志查询。 |
| 模板、状态、操作的历史写接口 | `/module/*` | 流程版本、节点模板、状态/操作节点配置、审核发布门禁 | 已映射到版本化定义和资源级权限；未暴露历史控制器中的无鉴权写接口。 |

## 7. 当前可访问副本逐文件清单（23 项）

下表覆盖 2026-08-19 在当前沙箱内实际可读取的全部文件。该结论只适用于裁剪副本；共享文件声明的原始 `AiFlowGraph.zip` 仍未在文件系统中出现，因此本表不能替代完整归档到位后的二次审计。

| 相对路径 | 类型 | 可证明的功能线索 | 当前映射或处置 |
|---|---|---|---|
| `backend/src/main/resources/static/index.html` | HTML | 前端入口与顶层壳层。 | `Home` 顶层控制台。 |
| `.../views/businessCenter.html` | HTML | 业务列表、搜索、新增/导入入口。 | `BusinessCenter`。 |
| `.../views/businessOverview.html` | HTML | 业务工作区、流程/权限导航。 | `ProjectWorkspace`。 |
| `.../views/design_process.html` | HTML | 状态流程工具栏、帮助、图例、画布操作。 | `WorkflowCanvas`。 |
| `.../views/initiatedProcess.html` | HTML | 已启动流程导航、看板、日历、待办。 | `ProcessWorkbench`。 |
| `.../views/processWarehouse.html` | HTML | 树形仓库、搜索、批量操作、预览。 | `WorkflowWarehouse`。 |
| `.../views/process_detail.html` | HTML | 流程引导、基本信息、运行实例表。 | `WorkflowGovernance`。 |
| `.../views/dataFlowCanvas.html` | HTML | 数据资源/函数树、画布工具、调度入口。 | `DataResourceCenter`。 |
| `.../views/dataflow_process_detail.html` | HTML | 数据流详情与操作审计展示。 | `DataResourceCenter` 的运行审计与调度区。 |
| `.../views/system_config.html` | HTML | 系统配置左栏和动态页签。 | `SystemConfigShell`。 |
| `.../assets/js/common/model.js` | JavaScript | 公共模型与枚举引用。 | 仅作状态文案/兼容审计线索。 |
| `.../assets/js/index.js` | JavaScript | 顶层页面初始化与路由线索。 | 顶层导航/页面状态已映射。 |
| `.../assets/js/initiatedProcess/initiatedProcess.js` | JavaScript | 启动流程工作台切换与实例查询线索。 | `ProcessWorkbench`、运行日志 API。 |
| `.../assets/js/processDesign/businessOverview.js` | JavaScript | 项目工作区导航与业务选择线索。 | `ProjectWorkspace`。 |
| `.../assets/js/processDesign/processDesignCenter.js` | JavaScript | 新增、详情、设计、审核、发布、取消发布、发起、启动、筛选。 | 项目流程生命周期、设计器与权限门禁。 |
| `.../assets/js/processDesign/datasourceManagement.js` | JavaScript | 数据源管理入口。 | P2 项目隔离数据源 API/页面。 |
| `.../assets/js/processDesign/resourceConfigPluginsManagement.js` | JavaScript | 插件资源管理入口。 | P2 项目插件资源。 |
| `.../assets/js/processDesign/tagCenter.js` | JavaScript | 标签中心入口。 | P2 数据标签资源。 |
| `.../assets/js/processDesign/udfManagement.js` | JavaScript | UDF 管理入口。 | P2 项目 UDF 元数据。 |
| `.../assets/js/processWarehouse/processWarehouse.js` | JavaScript | 仓库搜索、选择、批量导入导出。 | `WorkflowWarehouse`。 |
| `.../assets/js/systemConfig/systemConfig.js` | JavaScript | 系统设置与状态配置线索。 | `SystemConfigShell`、审批门禁、工作域。 |
| `backend-history/platform/src/main/java/.../FlowController.java` | Java | 流程操作、移交、回退、模板、状态与历史步骤接口。 | 见第 6 节安全映射。 |
| `backend-history/platform/bin/startup.sh` | Shell | 历史服务启动入口存在。 | 未执行；缺少依赖、配置和同目录工程文件，不能推断可部署契约。 |

## 8. 完整归档缺口复核

2026-08-19 已在当前本地可访问工作目录中再次检索 `AiFlowGraph.zip`、`designProcess/bundle.js` 与 `designProcess/canvas.js`。除第三方依赖目录中的同名文件外，未发现参考项目的完整归档或缺失画布脚本。因此本审计仍以本表的 23 项可读取文件为唯一证据；节点字段、默认值、帮助文案和校验规则无法由现有文件直接证明时，继续维持“兼容扩展”标记，等待完整归档到位后复核。
