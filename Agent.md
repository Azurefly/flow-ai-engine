# Flow AI Engine 开发协作约定

本项目把流程定义、运行实例、人员办理和项目数据放在同一个工作台。改动前先确认所属项目、操作针对的草稿或发布快照，以及执行人的有效权限。复用已有的版本检查、权限服务和 Worker 能避免不同入口给出不同结果。

## 开始和续接任务

在第一次编辑前阅读本文件、开发索引及下方与本次改动相应的约束。跨前后端、数据库和部署的工作，各层分别核对。变更既有约束时，将新约定和它影响的代码、用例放在同一轮评审中。

审计整改可直接从[优化任务交接](docs/development/optimization/START-HERE.md)领取编号，使用[任务队列](docs/development/optimization/queue.json)里的源码入口、依赖和验收场景。

1. 从[开发索引](docs/development/INDEX.md)按用户动作定位页面、tRPC 过程、领域服务和已有用例。续接工作时找回上次明确目标、已验证的结果及尚未验证的步骤。
2. 在仓库根目录用 PowerShell 查看 `git status --short --branch`、`git rev-parse HEAD` 和相关文件的差异。多人并行时记录被测版本。工作区变化后按文件差异决定需要复验的部分。
3. 审计、方案设计和实现分别交付。用户要求审计或设计时，交付证据、修改建议、验收条件。实现按本次任务授权进行。测试环境、业务样本和清理责任写在验收记录中。

## 本机开发

本仓库开发主机用 Windows 11、PowerShell 和 UTF-8。核对 [package.json](package.json) 的 `packageManager` 及锁文件再运行 pnpm。需要隔离进程环境时，在当前 PowerShell 会话设置 `$env:变量名`，路径用 `Join-Path` 或受引号保护的绝对路径。Windows 本机通过绑定在回环的端口访问测试服务，容器之间使用专用网络的服务名。记录测试库名，日志里省略连接口令。远程 Linux 部署命令的执行位置和用户以[部署说明](docs/deployment-linux-docker.md)为准。

## 横跨模块的约定

- **三种流程**共用定义外形，各有节点与执行约束。修改节点先读 `shared/workflow-node-contract.ts`、`shared/flow-profile-contract.ts`，再检查画布、编译、运行、诊断和老版本读取。
- **草稿和历史**各有身份。保存、审核、发布、恢复用用户实际读到的版本和审核状态。实例详情从该次运行的快照读取。
- **参与人与权限**是两条独立关系。待办的办理资格由任务、签署组、关系轮次及有效授权共同决定。读取、写入、资源切换时均要考虑权限变化。
- **已提交和已完成**是异步操作中的两个时间点。运行创建后保留 `runId`。后台作业有自己的状态和租约。报告终态前回读实例及与断言有关的持久化事实。
- **证据**写清源码、数据库、HTTP、浏览器和真实供应商分别验证了什么。排除模块、未配置依赖、失败断言、测试数据去向随结果一起交付。
- **工作区**保留用户未提交的改动、数据和服务。临时截图、测试输出及运行日志进入已忽略的 `.cache/`。长期设计、协作规则和测试源码归入对应目录。

## 按任务阅读

| 要做的事 | 先读 |
| --- | --- |
| 页面、画布、表单、权限可见性 | [前端开发约束](docs/development/frontend.md) |
| tRPC、流程执行、授权、作业 | [后端开发约束](docs/development/backend.md) |
| 修改持久化结构或迁移 | [数据库与迁移](docs/development/database.md) |
| 写用例、跑回归、记录证据 | [测试用例生成与验收](docs/development/testing.md) |
| 准备提交、推送、部署或回滚 | [提交与发布](docs/development/contributing.md) |
| 按本轮评审排期 | [整改与缺失模块设计](docs/development/remediation-design.md) |
| 调整 AI 助手、试聊或工作台工具 | [助手专项及验收](docs/development/assistant-review.md) |
