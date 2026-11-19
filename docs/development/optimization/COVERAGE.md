# 已执行测试与证据明细

这些记录对应整改前基线 `8964f07`。当前发布的测试计数、四项远程联测与逐项签收可从[实施与验收记录](IMPLEMENTATION.md)和[验收场景](ACCEPTANCE.md)读取。基线完整用例登记（本机离线包 `executed-tests.json`）含四组 Vitest 的文件路径、文件内序号、显示名称和判定。参数化名称含地址、身份或长样本时省略样本值，仍可按路径和序号查原报告。

## 源码门槛

| 门槛 | 文件数 | 通过 | 失败 |
| --- | ---: | ---: | ---: |
| `unit` | 325 | 2559 | 0 |
| `functional` | 8 | 71 | 0 |
| `scenario` | 2 | 13 | 0 |
| `mysql` | 32 | 49 | 1 |

四组共 2,693 条，跳过 0。下表列出功能、业务场景与真实 MySQL 的文件粒度。单元 325 个文件可在 JSON 中检索。

| 环境 | 仓库内文件 | 通过/总数 | 文件内用例内容举例 |
| --- | --- | ---: | --- |
| functional | `tests/functional/01-workflow-designer.functional.test.ts` | 10/10 | 每一个节点类型均有标准默认配置并可通过自身验证 |
| functional | `tests/functional/02-business-workspace.functional.test.ts` | 9/9 | 导入业务按钮：CSV 格式、表头容错、空值校验与重复代号拦截 |
| functional | `tests/functional/03-process-workbench.functional.test.ts` | 14/14 | 从看板或日历打开任务时保留原视图，关闭详情可返回上下文 |
| functional | `tests/functional/04-data-resource-center.functional.test.ts` | 6/6 | 资源表单提供可见字段标签并约束窄屏结构行宽度 |
| functional | `tests/functional/05-workflow-warehouse.functional.test.ts` | 4/4 | 平级目录与子级目录创建、更新与非空删除防护 |
| functional | `tests/functional/06-system-config-organization.functional.test.ts` | 7/7 | 通用设置与审批配置字段校验与管理员权限限制 |
| functional | `tests/functional/07-iam-auth.functional.test.ts` | 5/5 | 登录失败防爆破限制：5 次失败锁定与重试头生成 |
| functional | `tests/functional/08-ui-motion-regression.functional.test.ts` | 16/16 | 页面正文与控件使用14px，标题和辅助信息按统一层级呈现 |
| scenario | `tests/business-scenarios/01-procurement-state-flow.scenario.test.ts` | 6/6 | 步骤 1：业务流程拓扑语义静态编译与不可变执行计划生成 |
| scenario | `tests/business-scenarios/02-smart-ticket-control-flow.scenario.test.ts` | 7/7 | 步骤 1：控制流（Control Flow）拓扑定义编译验证与类型隔离校验 |
| mysql | `server/assistant-store.integration.test.ts` | 9/9 | 授予已办工具后仅新对话取得该权限，撤回后已有对话也随之失效 |
| mysql | `server/assistant-workspace.integration.test.ts` | 1/1 | 统计按账号和项目取数，确认同一项业务操作只写一次 |
| mysql | `server/auth-bootstrap-session.integration.test.ts` | 1/1 | 严格确保 bootstrap 管理员存在，登出和禁用都会使旧会话无法访问受保护路由 |
| mysql | `server/company-workflows.integration.test.ts` | 1/1 | 验证辞职会签、汇报或签和年假 3 天分支均写入真实任务与状态 |
| mysql | `server/iam-account-center.integration.test.ts` | 1/1 | 批量创建逐条返回结果，用户与角色均能查看直接及组织继承权限 |
| mysql | `server/iam-catalog.integration.test.ts` | 1/1 | 能够幂等初始化内置角色及全部权限目录 |
| mysql | `server/iam-custom-role.integration.test.ts` | 1/1 | 绑定权限后不可直接删除，撤销授权后可安全删除 |
| mysql | `server/internal-auth.integration.test.ts` | 1/1 | 登录、登出和禁用后失败登录均产生审计事件 |
| mysql | `server/leave-approval-state-flow.integration.test.ts` | 1/1 | 自动补员、人员状态、可执行操作和两级待办完整流转并持久化 |
| mysql | `server/operate-outcome-validation.integration.test.ts` | 1/1 | 错误审批结果可保存草稿，但发布必须拒绝，修复后可发布 |
| mysql | `server/operate-signing.integration.test.ts` | 0/1 | 或签首人完成即取消其他待办，会签达到比例前保持等待且只续跑一次 |
| mysql | `server/organization-management.integration.test.ts` | 1/1 | 扩展机构字段持久化，绑定权限即时继承且解绑即时失效 |
| mysql | `server/p1-system-config.integration.test.ts` | 1/1 | 仅管理员可管理系统设置和工作域，水印、审批门禁与项目工作域关联均真实生效 |
| mysql | `server/p1-task.integration.test.ts` | 1/1 | 指定项目运行者可移交、退回、批量领取并完成 operate 任务，外部用户看不到任务，完成后由服务端续跑 |
| mysql | `server/p2-resource-dataflow.integration.test.ts` | 1/1 | 资源、样本和数据流运行严格受项目边界保护 |
| mysql | `server/p2-schedule-callback.integration.test.ts` | 1/1 | 仅可信任务 UID 可触发一次数据流运行，非法与重复回调均不重复执行 |
| mysql | `server/participant-state.integration.test.ts` | 8/8 | 提交、撤回、换人再提交、完成与重试，旧待办失效 |
| mysql | `server/project-department-access.integration.test.ts` | 1/1 | 多部门与直接角色共同生效，项目与流程权限一致，撤销及停用即时失效 |
| mysql | `server/project-member-visibility.integration.test.ts` | 1/1 | 项目可见成员仅包含当前生效授权；撤销、到期、未生效与停用账号不会继续显示 |
| mysql | `server/project-original-flow.integration.test.ts` | 1/1 | 项目运行者可发起已发布流程，查看者和未发布流程均被拒绝，原始声明节点安全落库 |
| mysql | `server/project-workflow-creation-fields.integration.test.ts` | 1/1 | 项目创建仅接受本项目数据源，持久化代号与来源并阻止重复代号 |
| mysql | `server/project-workspace.integration.test.ts` | 1/1 | 项目成员仅能访问授权项目，并可完成流程审核、发布和仓库归档 |
| mysql | `server/service-endpoint-management.integration.test.ts` | 1/1 | 管理员可维护端点，查看者可选择本项目端点，未授权人员无法读取 |
| mysql | `server/workflow-definition-persistence.integration.test.ts` | 1/1 | 导入 JSON 后保存、重读、导出再解析和复制均保持完整定义 |
| mysql | `server/workflow-engine.integration.test.ts` | 1/1 | 可在服务器端完成 HTTP、转换、条件与结束节点并写入节点日志 |
| mysql | `server/workflow-governance.integration.test.ts` | 1/1 | 版本快照、回滚、告警、个人模板与子流程都遵循资源/用户隔离 |
| mysql | `server/workflow-management.integration.test.ts` | 1/1 | 管理员可复制删除流程，并可授予、撤销带有效期的成员角色 |
| mysql | `server/workflow-node-history.integration.test.ts` | 1/1 | reads repeated visits with large JSON under a small MySQL sort buffer |
| mysql | `server/workflow-owner-protection.integration.test.ts` | 1/1 | 拒绝撤销流程唯一有效所有者 |
| mysql | `server/workflow-participant-directory.integration.test.ts` | 1/1 | 流程编辑者可搜索和回显处理人，查看者和撤权用户无权访问 |
| mysql | `server/workflow-permissions.integration.test.ts` | 1/1 | 所有者可运行、查看者可读日志，未授权用户被拒绝且授权快照已持久化 |
| mysql | `server/workflow-worker.integration.test.ts` | 4/4 | atomically queues, deduplicates and reclaims an expired lease |

## 最终镜像的 12 组 HTTP 套件

| 编号与套件 | 退出码 | 业务范围及结果 |
| --- | ---: | --- |
| HTTP-01 · `remote-deployment` | 0 | 隔离同镜像的 HTTP 验收。项目内目录、运行、分页和授权撤销有服务回读；脚本名含 remote，本轮目标是回环副本。 |
| HTTP-02 · `router-label` | 1 | 路由发布合同。原夹具未完成设计合同。早期对照补齐修订与双方汇聚后四个场景均可到达预期分支。 |
| HTTP-03 · `loop-runtime` | 0 | 控制/状态循环与等待。各轮访问保留独立事实，人工循环任务不同，两个并行分支访问 3/2 次，超限按设计失败。 |
| HTTP-04 · `parallel-human` | 0 | 并行人工办理。合成办理人推进并行分支，查询终态及汇聚事实。 |
| HTTP-05 · `parallel-message` | 0 | 并行消息及去重。并行发布样本验证分支隔离、重复拒绝、一次汇聚。重启、暂停等可选场景只按本次日志布尔值认定。 |
| HTTP-06 · `signing` | 0 | 签署、并发和移交。或签、比例、顺序、委托和加减签按各自断言运行。通过样本的终点执行一次。 |
| HTTP-07 · `dataflow-join-function` | 0 | 关联、函数与运行产物。经过真实数据流执行器；输出和汇总依照脚本期望核对。 |
| HTTP-08 · `dataflow-quality` | 1 | 质量阈值与输入拒绝。0.25 阻断、0.50 成功。1.1 在创建即拒绝，原脚本提前退出。 |
| HTTP-09 · `dataflow-deduplicate` | 0 | 筛重与关联统计。6 行筛成 4 行、总值 100；另一组关联后 3 行、总值 40。 |
| HTTP-10 · `warehouse-roundtrip` | 0 | 三类流程仓库往返。预检无草稿写入、重放、测试/正式运行、归档与恢复。脚本维护的运行清单有 7 个 ID。 |
| HTTP-11 · `task-reassignment` | 0 | 转交及办理权。状态/控制样本覆盖不同签署方式。检查原/新办理资格、竞争胜者和表单保留。 |
| HTTP-12 · `run-metrics` | 1 | 空、成功、终止样本计时。固定流程导致权限拒绝。独立自建 waiting→terminated 样本总 1、计时 0、均值 null。 |

## 最终浏览器 36 项

| 编号与检查 | 结果 | 验证深度或限制 |
| --- | --- | --- |
| UI-01 · `remote-login-page` | 通过 | 远程匿名页面检查；明文入口显示登录，见 F02。 |
| UI-02 · `login` | 通过 | 本机同镜像，专用账号经真实浏览器登录。 |
| UI-03 · `business-create` | 通过 | 通过业务中心新增合成业务。 |
| UI-04 · `business-filter` | 通过 | 通过搜索按本轮条件筛选业务。 |
| UI-05 · `bdp-control` | 通过 | 断言按钮禁用；能力缺失见 G03。 |
| UI-06 · `csv-standard` | 通过 | 含逗号及双引号的说明回读一致。 |
| UI-07 · `csv-multiline` | 失败 | 合法多行说明被拒，目标业务未创建。 |
| UI-08 · `csv-unclosed-quote` | 失败 | 未闭引号被接纳，服务读到残缺说明。 |
| UI-09 · `csv-partial-retry` | 失败 | 首行已建，纠正次行后被首行占码挡住。 |
| UI-10 · `workspace` | 通过 | 进入业务工作区。 |
| UI-11 · `project-权限配置中心` | 通过 | 进入项目权限配置中心；持久授权另有真库用例。 |
| UI-12 · `project-服务端点` | 通过 | 进入项目服务端点页；端点授权由专用集成用例验证。 |
| UI-13 · `project-资源配置中心` | 通过 | 进入项目资源配置中心。 |
| UI-14 · `resource-数据源` | 通过 | 浏览器打开“数据源”页签；此项只验证页面入口。 |
| UI-15 · `resource-资源探查` | 通过 | 浏览器打开“资源探查”页签；此项只验证页面入口。 |
| UI-16 · `resource-函数` | 通过 | 浏览器打开“函数”页签；此项只验证页面入口。 |
| UI-17 · `resource-标签` | 通过 | 浏览器打开“标签”页签；此项只验证页面入口。 |
| UI-18 · `resource-项目插件` | 通过 | 浏览器打开“项目插件”页签；此项只验证页面入口。 |
| UI-19 · `resource-数据流` | 通过 | 浏览器打开“数据流”页签；此项只验证页面入口。 |
| UI-20 · `workflow-detail` | 通过 | 进入流程详情。 |
| UI-21 · `workflow-editor` | 通过 | 进入流程设计器；补充试验另验拖动、保存、重开。 |
| UI-22 · `monitor` | 通过 | 进入运行监控，可见运行信息。 |
| UI-23 · `workbench` | 通过 | 进入工作台；独立交互样本实际办理后查任务及实例终态。 |
| UI-24 · `warehouse` | 通过 | 页面可达；补充以唯一标题和归档面板操作增强断言。 |
| UI-25 · `identity-users` | 通过 | 打开用户视图，实际权限和持久创建由其他层验证。 |
| UI-26 · `identity-roles` | 通过 | 打开角色视图。 |
| UI-27 · `identity-audit` | 通过 | 打开权限审计视图。 |
| UI-28 · `organization` | 通过 | 页面可达；补充断言标题“组织架构管理”。 |
| UI-29 · `organization-write` | 通过 | 新增部门，补充刷新后以服务端回读核对。 |
| UI-30 · `system-通用设置` | 通过 | 浏览器打开“通用设置”页签；此项只验证页面入口。 |
| UI-31 · `system-审批配置` | 通过 | 浏览器打开“审批配置”页签；此项只验证页面入口。 |
| UI-32 · `system-模型服务` | 通过 | 浏览器打开“模型服务”页签；此项只验证页面入口。 |
| UI-33 · `system-工作域配置` | 通过 | 浏览器打开“工作域配置”页签；此项只验证页面入口。 |
| UI-34 · `system-运行诊断` | 通过 | 浏览器打开“运行诊断”页签；此项只验证页面入口。 |
| UI-35 · `workdomain-write` | 通过 | 工作域创建后有界面反馈。 |
| UI-36 · `mobile` | 通过 | 390px 视口整体无横向溢出，表内主操作仍受限。 |

## 助手专项与本次扩写的新增复核

以下为独立的受控模型 Edge 验收动作，另有真实部署的提案与业务确认，见 E13。列表中的“通过”以该场景的模型及业务环境为范围。

1. 从助手进入管理后面板自动收起
2. 确认重新新建会恢复空白表单 = true
3. 真实登录，隐藏管理页创建并保存 Agent
4. 新建成功后显示保存反馈 = true
5. 试聊模拟确认后业务水印没有变化
6. 390px 管理配置表单和试聊可见，页面与试聊无横向溢出
7. 首个 start 已落库、响应丢失、刷新后原文保留；重试同一 sessionId，库内只有一份会话和一个回合
8. 390px 悬浮助手输入与发送按钮在视口内，面板无横向溢出
9. 普通客户从真实待办结果跳到指定任务
10. 普通账号查到本人当前项目的已办并打开详情，其他人和其他项目均被排除
11. 补充办理人、刷新恢复预览、确认重放、草稿落库并打开画布
12. 普通账号无水印工具且管理接口返回 403
13. 双标签提交相同基准版本：服务器拒绝落后请求，原文字保留，重发后仅追加一个回合
14. 管理员在客户入口确认配置，MySQL 读取到新水印
15. 列表请求中断后原地重新加载成功

本次扩写在相同提交另行执行了两组定向用例，均通过。总门槛中的对应场景只计一次。

| 文件 | 本次复跑的断言 |
| --- | --- |
| `server/assistant-runtime.test.ts` | 提供服务器时刻和用户时区供相对日期统计使用 |
| `server/assistant-runtime.test.ts` | feeds server-read results to the model and keeps real resource links in the transcript |
| `server/assistant-runtime.test.ts` | keeps completed-task access separate from pending-task access |
| `server/assistant-runtime.test.ts` | pauses for information and uses prior answers on the following turn |
| `server/assistant-runtime.test.ts` | prevents preview commits, stale confirmations and use of revoked tools |
| `server/assistant-runtime.test.ts` | accepts an explicit chat decision without another model call |
| `server/assistant-runtime.test.ts` | retains customer input and clears prior confirmation on a failed revision |
| `server/assistant-runtime.test.ts` | retains a checked proposal after a model summary or transient commit failure |
| `server/assistant-runtime.test.ts` | replaces the old confirmation after a conversational revision |
| `server/assistant-runtime.test.ts` | serializes paired native tool calls and result IDs on the provider wire |
| `server/project-import-preflight.test.ts` | 导入预检只读取当前所有者的所选代号，包括已归档项目保留的代号 |
| `server/project-import-preflight.test.ts` | 无项目创建权限不读取代号，不能探测其他所有者的私有项目 |
| `server/project-import-preflight.test.ts` | 无效或超过批次上限的预检不执行查询 |
| `server/project-import-preflight.test.ts` | 无效或超过批次上限的预检不执行查询 |
| `server/project-import-preflight.test.ts` | 无效或超过批次上限的预检不执行查询 |
| `server/project-import-preflight.test.ts` | 导入代号格式错误提供直接可读的中文反馈 |
| `server/project-import-preflight.test.ts` | 预检后并发创建仍由唯一约束拦截，返回中文错误并回滚事务 |

## 从编号追到证据

证据索引（本机离线包 `evidence-index.json`）为每组提供环境、原件相对路径、冻结摘要及可离线核对的观察值。完整原件按项目约定保存在持有审计工作区的一侧。

| 编号 | 内容 | 实测范围 |
| --- | --- | --- |
| E01 | 源码、镜像、时间点与构建 | 最终提交、远程镜像标识、本机同摘要副本 |
| E02 | MySQL 真实持久化、授权、运行和恢复 | 最终提交、隔离 MySQL |
| E03 | 浏览器入口、表单与运行页面 | 最终镜像 Edge；首项为外部匿名页 |
| E04 | CSV 文件上传和持久值 | 最终镜像 Edge、业务接口回读 |
| E05 | 真实目录、工作区及页面补充断言 | 最终镜像、隔离合成账号 |
| E06 | 仓库往返、内联子流程与并行循环 | 最终镜像、HTTP 和 Worker |
| E07 | 签署、移交、恢复作业与计时观察 | 最终签署/移交 HTTP；早期专项三次及同一实例两时点 |
| E08 | 三组 HTTP 红灯及路由对照 | 最终镜像原套件；早期自建路由作对照 |
| E09 | 手动重发、原生调度和取消 | 最终镜像正常业务；慢查询为早期受控锁样本 |
| E10 | 运行监控的计时分母 | 最终镜像 HTTP 与自建终止实例 |
| E11 | 资源能力声明、真实转换、子流程边界 | 最终镜像与真实 MySQL |
| E12 | 真实模型与 IAM 建议 | 审计时实际部署供应商；最终部署复核模型连通性 |
| E13 | 客户助手与实际目录写回 | 部署助手、真实外部模型和专用项目 |
| E14 | 助手管理/试聊/客户、确认与中断恢复 | 受控回环模型、Edge 和真实 MySQL |
| E15 | 助手历史正文大小 | 隔离账号，按序创建空会话，无模型调用 |
| E16 | 动效、焦点、节点持久化和布局 | 最终镜像 Edge；早期画布截图和固定 GitHub 源码 |
| E17 | 测试源码与对外登录入口 | 源码脱敏扫描、远程匿名访问、额外部署状态 |
| E18 | 远程合成项目及隔离资源收尾 | 按本轮专用对象归档；本机专用资源清理 |

## PowerShell 7 查询示例

在解压目录中读取登记，用下列查询列出本轮未通过的数据库用例及浏览器项。

```powershell
$auditCases = Get-Content -Raw -Encoding utf8 './executed-tests.json' | ConvertFrom-Json
$auditCases.sourceGates.mysql.files.cases | Where-Object outcome -eq 'failed' | Select-Object id, title
$auditCases.browserChecks | Where-Object outcome -eq 'failed' | Select-Object id, name, observation
```
