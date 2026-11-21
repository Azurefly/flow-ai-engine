# Flow AI Engine 开发索引

从用户遇到问题的入口开始找。页面使用 React 和 React Flow，通过 tRPC 调用 Node 服务。MySQL 保存流程定义、不可变运行快照、任务、后台作业和审计记录。流程发起成功只确认接单，判断业务完成还要读取实例、节点或任务终态。

## 按工作目标阅读

| 当前任务 | 文档 |
| --- | --- |
| 新人或开发代理接手 | [仓库协作约定](../../Agent.md)、[当前系统设计](architecture.md)、[产品范围与本机启动](../../README.md) |
| 理解或演示三类流程 | [流转语义、内置节点与运行截图](../workflow-guide.md) |
| 修改本次新增的四个模块 | [版本化 API、文件与外部写回](optimization/G01-IMPLEMENTATION.md)、[持久父子流程](optimization/G02-IMPLEMENTATION.md)、[内部目录批量导入](optimization/G03-IMPLEMENTATION.md)、[助手后台回合](optimization/G04-IMPLEMENTATION.md) |
| 领取优化任务或拆分开发工作 | [智能体交接入口](optimization/START-HERE.md)、[产品能力索引](optimization/CAPABILITIES.md)、[19 张任务卡](optimization/TASKS.md)、[67 条验收场景](optimization/ACCEPTANCE.md)、[结构化队列](optimization/queue.json) |
| 核对本轮发布和剩余验收 | [产品发布验收](optimization/PRODUCT-RELEASE.md)、[实施与实测回执](optimization/IMPLEMENTATION.md)、[脱敏发布证据](optimization/release-evidence.json)、[逐项验收状态](optimization/queue.json) |
| 了解原始问题和方案取舍 | [功能与需求评审摘要](review-baseline.md)、[功能补齐与整改设计](remediation-design.md) |
| 调整页面、交互或动效 | [前端约束](frontend.md)、[开源动效研究与界面评审](ui-motion-review.md)、[查询交互回归表](../query-interaction-regression-checklist.md) |
| 新增接口、节点、作业、表 | [后端约束](backend.md)、[数据库与迁移](database.md)、[节点契约](../aiflow-reference-node-contract.md) |
| 理解人员状态与审批 | [参与人状态路由](../participant-state-routing-design.md)、[并发验收](../participant-state-concurrency-acceptance.md) |
| 生成用例并交付测试证据 | [测试用例生成与验收](testing.md)、[可复制的用例卡与实例](test-case-template.md) |
| 准备提交或发版 | [提交与发布约束](contributing.md)、[Linux / Docker 部署](../deployment-linux-docker.md) |

仓库收录[完整审计报告](optimization/REPORT.md)、[需求追踪矩阵](optimization/REQUIREMENTS.md)、[分层测试明细](optimization/COVERAGE.md)和[基线 API 清单](optimization/api-inventory.json)。逐用例原始记录与截图存放在审计工作区的 `.cache/functional-audit-20261119/handoff/`。

## 从页面定位到执行与验收

[当前注册的 API](optimization/api-current.json)按模块列出 224 个过程和调用方式。接口变化后在仓库根目录运行 `node --import tsx scripts/index-project-api.mjs` 更新；加 `--check` 可检查生成物。在审计时点做对照可读取上面的基线清单。

在 [Home](../../client/src/pages/Home.tsx) 找页面装配，在 [console-route](../../shared/console-route.ts) 找可直达的路由，在 [routers](../../server/routers.ts) 找同名 tRPC 过程。表定义及索引集中在 [schema](../../drizzle/schema.ts)。下表的最后一列是适合修改后先跑的一条用例。

| 业务路径 | 页面或共享入口 | 后端与持久化 | 入门用例 |
| --- | --- | --- | --- |
| 账号登录、退出、禁用与失权 | [身份工作区](../../client/src/components/IdentityWorkspace.tsx) | `auth`、`iam`，`users` 与会话，角色分配和审计。[权限写服务](../../server/iam-locked-permissions.ts) | [登录会话](../../server/auth-bootstrap-session.integration.test.ts) |
| 组织树、主部门、成员和权限继承 | [组织管理](../../client/src/components/OrganizationManagementPage.tsx) | `config.organizationDirectory`、[组织写服务](../../server/organization-write-service.ts) | [组织权限](../../server/organization-management.integration.test.ts) |
| 业务项目、工作域、CSV、项目角色和部门授权 | [业务中心和工作区](../../client/src/components/ProjectWorkspace.tsx) | `project`、`config.workDomains`、[项目生命周期](../../server/project-lifecycle.ts) | [项目工作区](../../server/project-workspace.integration.test.ts)、[多部门授权](../../server/project-department-access.integration.test.ts) |
| 流程设计、三类节点、草稿、审核、版本恢复 | [画布](../../client/src/components/WorkflowCanvas.tsx)、[节点契约](../../shared/workflow-node-contract.ts) | `workflow`、`project.auditWorkflow`、[编译](../../server/workflow-compiler.ts)、[版本](../../server/workflow-revision.ts) | [定义往返保存](../../server/workflow-definition-persistence.integration.test.ts) |
| 流程仓库、归档恢复、导出及导入 | [流程仓库](../../client/src/components/WorkflowWarehouse.tsx) | [仓库导入](../../server/warehouse-import.ts)、[创建请求记录](../../server/workflow-creation-request.ts) | [三类流程往返验收](../../scripts/warehouse-roundtrip-acceptance.mjs) |
| 状态与控制流、条件、并行、循环、子流程、LLM | [流程类型契约](../../shared/flow-profile-contract.ts) | [运行准入](../../server/workflow-run-readiness.ts)、[执行器](../../server/workflow-engine.ts)、[同步子流程诊断](../../server/subflow-diagnostics.ts) | [真实 HTTP 与节点日志](../../server/workflow-engine.integration.test.ts)、[流程治理](../../server/workflow-governance.integration.test.ts) |
| 收件、会签、或签、移交、撤回、人员卡片 | [工作台](../../client/src/components/ProcessWorkbench.tsx)、[实例画布](../../client/src/components/RunExecutionCanvas.tsx) | `task`、[任务服务](../../server/p1-service.ts)、[人员状态](../../server/participant-state-runtime.ts) | [参与人全生命周期](../../server/participant-state.integration.test.ts)、[办理动作](../../server/p1-task.integration.test.ts) |
| 实例、作业租约、断点恢复、告警、运行平均耗时 | [运行中心](../../client/src/components/RunCenter.tsx) | `workflow.runDetail`、`workflow.runMetrics`、[Worker](../../server/workflow-worker.ts) | [Worker 崩溃恢复](../../server/workflow-worker.integration.test.ts)、[重复访问节点历史](../../server/workflow-node-history.integration.test.ts)、[运行告警桌面验收 FT016](../../01-test/013-测试用例/02-模块功能用例/AiFlowGraph-模块功能用例.md#测试点-ft016) |
| 数据源、资产、函数、标签、项目插件、血缘 | [资源中心](../../client/src/components/DataResourceCenter.tsx)、[数据源能力](../../shared/data-source-capabilities.ts) | `data`、[数据服务](../../server/p2-service.ts)、[资源准入](../../server/dataflow-resource-readiness.ts) | [真实资源和数据流](../../server/p2-resource-dataflow.integration.test.ts) |
| 数据运行、质量门槛、取消、原生及旧托管调度 | [调度表单](../../shared/dataflow-schedule-form.ts) | [调度](../../server/dataflow-schedule.ts)、[数据服务](../../server/p2-service.ts)。作业、实例、调度 revision 与时间桶分别持久化 | [调度回调去重](../../server/p2-schedule-callback.integration.test.ts)、[数据质量 HTTP 用例](../../scripts/dataflow-quality-acceptance.mjs) |
| 项目服务端点、系统配置、模型服务和运行诊断 | [系统配置](../../client/src/components/SystemConfigShell.tsx) | [端点](../../server/service-endpoint-service.ts)、[模型配置](../../server/llm-configuration.ts)、[运行信息](../../server/runtime-info.ts) | [端点授权](../../server/service-endpoint-management.integration.test.ts)、[设置与工作域](../../server/p1-system-config.integration.test.ts) |
| AI 助手管理、试聊与客户会话 | [Agent 配置](../../client/src/components/AgentSettings.tsx)、[对话](../../client/src/components/AssistantChat.tsx) | [助手路由](../../server/assistant-router.ts)、[会话与配置](../../server/assistant-store.ts)、[模型回合](../../server/assistant-runtime.ts)、[工作台工具](../../server/assistant-workspace.ts) | [会话与回执](../../server/assistant-store.integration.test.ts)、[业务写入确认](../../server/assistant-workspace.integration.test.ts) |

客户悬浮助手、`#/system/agents` 管理和试聊、流程 LLM 节点、账号创建预览是四条不同的模型调用路径。最终审计覆盖四条路径。助手会话分页、长期回执与运维设计见[助手专项评审](assistant-review.md)。

## 维护索引

改页面路由、权限、节点运行语义或测试入口时，在同一变更中更新对应一行。需求缺口用设计编号关联验收用例。长期结论保留在本目录。一次运行的 JSON、截图和主机相关记录按仓库约定放在本地 `.cache/`。[仓库文件约定](../../README.md#仓库文件约定)
