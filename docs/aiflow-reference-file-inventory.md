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
