# 产品能力与优化任务索引

每个 R 编号代表一个用户可观察的结果。仓库中按 tRPC 名称定位实现，接口行号以开发所用提交为准。按[优化任务卡](TASKS.md)与[验收场景](ACCEPTANCE.md)核对跨模块影响。需求的实测编号和未覆盖范围见审计包内的 `REQUIREMENTS.md` 与 `requirements.json`。

| 编号与需求 | 相关过程 | 整改或设计 | 沿用合同与追加验收 |
| --- | --- | --- | --- |
| R01 可登录、注销、禁用与撤权 | `auth.login`、`auth.me`、`auth.logout` | F01、F02 | OAuth 租户与受保护外网入口另需签收。 |
| R02 用户目录、角色及项目范围授权 | `iam.userDirectory`、`iam.roleMembersPage`、`iam.assignSystemRole`、`iam.revokeRoleAssignment` | 既有回归 | 每种到期/撤权组合还需按实际客户角色做 UI 样本。 |
| R03 普通账号创建与模型建议 | `iam.previewUserCreation`、`iam.previewUserBatch`、`iam.createUser`、`iam.createUsersBatch` | 既有回归 | 远程样本止于显式确认前，真实批次规模须单独约定。 |
| R04 组织、工作域与系统设置 | `config.organizationDirectory`、`config.createOrganizationUnit`、`config.workDomains`、`config.updateSetting` | 既有回归 | 五个设置页签逐项修改、刷新及失权恢复需要按变更补做浏览器回归。 |
| R05 项目身份、成员、部门、端点 | `project.create`、`project.grantMember`、`project.grantUnit`、`project.serviceEndpoints` | 既有回归 | 真实外部服务可达性取决于该项目的端点配置。 |
| R06 业务清单导入与纠错 | `project.existingCodes`、`project.activeDomains`、`project.create` | F03、F04、U02 | 批次事务、竞争和续传按 A07–A16、A40–A41 验收。 |
| R07 流程草稿、审核、发布、恢复 | `project.createWorkflow`、`project.auditWorkflow`、`workflow.update`、`workflow.publish`、`workflow.rollbackVersion` | U04 | 复杂画布缩放、遮挡与拖动的组合需按 A44–A46 复验。 |
| R08 流程仓库、导入导出和复用 | `project.warehouse`、`project.previewWorkflowImport`、`project.exportWorkflows`、`workflow.templates` | 既有回归 | 模板 CRUD 每条接口的单独浏览器验收未在本轮逐项登记。 |
| R09 状态流及参与人生命周期 | `workflow.run`、`workflow.runDetail`、`workflow.participantDirectory`、`task.execute` | 既有回归 | 保留撤回、旧待办失效和所有者权限边界。 |
| R10 路由、循环和并行汇聚 | `workflow.compile`、`workflow.publish`、`workflow.run`、`task.signalMessage` | F07 | 同镜像的原三组须独立变绿；早期补充路由覆盖不替代新版本验收。 |
| R11 签署、移交、重复办理 | `task.complete`、`task.handover`、`task.delegate`、`task.reassign` | F06 | 对齐实例与作业终态，仍检查竞争和一次出口。 |
| R12 运行监控、计时与告警 | `workflow.runMetrics`、`workflow.runHistoryPage`、`workflow.alerts`、`system.notifyOwner` | F07 | 通知真实接收、恢复目标和生产负载待验。 |
| R13 资源登记、探查与执行能力 | `data.resources`、`data.testSource`、`data.createAsset`、`data.runLineage` | G01 | 登记及 probe 的成功不能推出 API/文件可读或可向第三方写入。 |
| R14 数据关联、函数、筛重和质量 | `data.run`、`data.runDetail`、`workflow.runReadiness` | F07 | 分别重测每种非法输入，避免首个异常掩盖后续。 |
| R15 人工数据运行及结果核对 | `data.run`、`data.runs`、`data.runDetail`、`data.cancelRun` | F05 | 三处 UI 意图身份、同键并发、兼容旧运行。 |
| R16 原生调度、暂停、删除及取消 | `data.saveScheduleDraft`、`data.activateSchedule`、`data.pauseSchedule`、`data.deleteSchedule` | 既有回归 | 旧托管删除需要专用的外部旧任务。慢查询取消样本仅代表测试驱动。 |
| R17 项目端点、系统模型与流程 LLM | `project.serviceEndpoints`、`config.checkModelService`、`workflow.runtimeModels`、`workflow.run` | F08 | 真实三节点流程和最终连通性取自两个阶段；历史缺请求模型记录。 |
| R18 助手管理、发布与试聊 | `assistant.adminAgents`、`assistant.saveDraft`、`assistant.publish`、`assistant.start` | U06 | 真实模型自由措辞的稳定性需独立标注集。 |
| R19 客户助手提案、确认与重放 | `assistant.available`、`assistant.message`、`assistant.decide`、`assistant.get` | G04、U06 | 远程样本限统计和创建目录。工具级遥测与长回合恢复需补。 |
| R20 助手历史列表与消息恢复 | `assistant.sessions`、`assistant.get` | F09、U06 | 需按可见性分页、真机选取与跨项目确认验收。 |
| R21 键盘弹窗与业务反馈 | `project.create`、`project.existingCodes` | U01、U02 | 嵌套确认、提交成功、触发者消失分别验收。 |
| R22 窄屏、视口定位和工作台连续操作 | `project.page`、`task.dashboard`、`task.page`、`workflow.get` | U03、U04、U05 | 360/390/768、真机和后台轮询保持焦点与位置。 |
| R23 独立等待的异步子流程 | `workflow.subflows`、`workflow.createSubflow`、`workflow.run` | G02 | 一层人工子实例、父子权限与崩溃后恢复按 A55–A58 验收。 |
| R24 内部账号、部门和成员关系批量导入 | `directoryImport.preview`、`directoryImport.applyRow`、`directoryImport.revert` | G03 | 业务与人员工作区可打开目录导入，逐行鉴权及回退。 |
| R25 部署就绪与运营证明 | `system.health`、`config.readiness`、`config.runtimeInfo` | F01、F02 | 真实通知、OAuth、对象存储、恢复 RPO/RTO、负载与第三方签收另行取证。 |
