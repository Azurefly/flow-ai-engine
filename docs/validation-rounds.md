# Flow AI Engine 审查—修改—审查台账

本台账仅记录实际执行过的数据库集成测试、类型检查、已登录浏览器闭环或平台托管任务核验。页面源码断言不能替代真实数据库验证；生产计划首跑在下一次 UTC 触发后另行补记。

| 轮次 | 变更或审查重点 | 真实核验范围 | 结果与证据 |
|---:|---|---|---|
| 1 | 内部账号与会话基线 | 管理员引导、密码哈希、登录/注销 | `auth-bootstrap-session`、`internal-auth`、`auth.logout` 集成测试。 |
| 2 | IAM 与资源权限 | 系统角色、流程角色、临时授权、最后所有者保护 | `iam-*`、`workflow-permissions`、`workflow-owner-protection` 数据库测试。 |
| 3 | 自主工作流执行 | LLM 目录、HTTP SSRF 拒绝、节点运行审计 | `workflow-engine*`、`workflow-llm` 集成测试。 |
| 4 | P0 项目工作区 | 项目隔离、审核、发布、仓库归档 | `project-workspace`、`project-original-flow` 集成测试。 |
| 5 | 路由与人工操作 | 分支句柄、人工待办、服务端续跑 | `workflow-engine`、`p1-task` 集成测试。 |
| 6 | P1 系统设置 | 审批门禁、工作域、水印和管理员权限 | `p1-system-config` 集成测试。 |
| 7 | P2 数据资源域 | 项目隔离、资源探查、只读 SQL 与运行审计 | `p2-resource-dataflow` 集成测试。 |
| 8 | 设计器统一节点契约 | 草稿/执行边界、默认值、旧式路由/表单/结束模板兼容 | `workflow-node-contract`、`workflow-definition-validation`。 |
| 9 | 设计器重建 | 原始工具栏、配置状态、字段化属性面板与模板入口 | `workflow-ui-regression` + 类型检查。 |
| 10 | 流程详情与数据流工具 | 流程引导、资源/函数树、任务详情、调度入口 | `workflow-ui-regression`、`p2-resource-dataflow`。 |
| 11 | 托管计划生命周期 | 真实创建可信任务 UID、暂停—恢复、活动状态持久化 | 数据库 `dataflow_schedule`、平台任务 UID `LZdLD7JML8zvtPWtiXFEj8`、`manus-heartbeat list`。 |
| 12 | 计划回调幂等 | task UID + UTC 分钟桶唯一运行键 | `dataflow_run.scheduleBucket` 迁移、唯一索引与 P2 数据库回归。 |
| 13 | 全量并行稳定性 | 审批全局设置污染定位并修复 | 命名锁后 `pnpm test`：24 文件、41 项通过。 |
| 14 | 系统配置页面细节 | 左栏收起/展开、卡片页签，设置能力无回归 | `p1-system-config`、`workflow-ui-regression` 与全量回归。 |
| 15 | 节点配置持久化 | 开始、状态、操作、路由、REST、结束字段的保存、重读、导出、复制 | `workflow-definition-persistence` 真实数据库测试；全量 24 文件、41 项通过。 |

## 当前尚待记录的生产验收

| 验收项 | 条件 | 通过标准 |
|---|---|---|
| 首次托管回调 | 将最新检查点发布到生产环境，等待 `0 0 9 * * *` UTC 触发。 | `dataflow_schedule.lastTriggeredAt` 与 `lastRunId` 写入，平台日志返回 2xx。 |
| 重复回调幂等 | 在同一 UTC 分钟内获得重投递或平台重试。 | 只存在一条相同 `workflowId + scheduleBucket` 的 `dataflow_run`。 |
| 非法回调拒绝 | 无计划身份请求 `/api/scheduled/dataflow`。 | 返回 403，且不创建 `dataflow_run`。 |
| 已登录浏览器编辑 | 使用内部账号登录最新发布版本。 | 配置面板字段编辑、保存、刷新、导入/导出与运行日志一致。 |
