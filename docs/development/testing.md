# 测试用例生成与验收

把需求中的每个承诺改写为能观察的结果。例如“支持重试”需要写清谁在何时重试、怎样判断是同一请求、最终应有几条实例、作业、业务记录和审计。用例及实际结果分别维护。复制[用例卡与实例](test-case-template.md)即可开始。

## 选择证据层

| 层级 | 适合证明 | 本项目入口 |
| --- | --- | --- |
| 单元与契约 | 解析、类型、计算、路由、错误映射、旧定义兼容 | [单元配置](../../vitest.unit.config.ts)，`server` 和 `shared` |
| 功能与场景 | 多角色或业务场景规则的组合。核对每个用例使用的替身与真实依赖 | [功能配置](../../vitest.functional.config.ts)、[场景配置](../../vitest.scenario.config.ts) |
| 真实 MySQL | SQL、锁、事务回滚、快照、持久作业、同一请求竞争 | [MySQL 配置](../../vitest.mysql.config.ts)，使用本轮专用数据库 |
| HTTP 与运行时 | 正常 tRPC 身份和 Cookie、路由、版本、真正的 Worker 领取和终态、跨请求可见性 | [发布验收示例](../../scripts/remote-deployment-acceptance.mjs)、[显式目标检查](../../scripts/router-acceptance-safety.mjs) |
| 真实浏览器 | 可定位并完成操作、键盘、焦点、减少动效、错误恢复、刷新后回读 | [浏览器用例目录](../../01-test/014-自动化脚本/e2e/README.md) |
| 部署及第三方 | 线上实际镜像、外部服务的回执、取消、送达与授权范围 | [部署说明](../deployment-linux-docker.md)、[供应商专用配置](../../vitest.provider.config.ts) |

PowerShell 在仓库根目录按变更范围执行以下命令。`test` 使用独立的默认配置，专项门槛分别运行。真实数据库从专用测试环境注入 `DATABASE_URL`，用前确认目标库名及迁移版本。MySQL 套件会修改全局配置和测试夹具，使用隔离库。供应商用例另需经授权、已配置的专用连接。

```powershell
pnpm check
pnpm test:unit
pnpm test:functional
pnpm test:scenario
pnpm test:integration:mysql
pnpm build
```

定向用例示例，PowerShell 在仓库根目录执行。

```powershell
pnpm exec vitest run --config vitest.mysql.config.ts server/workflow-worker.integration.test.ts
pnpm exec vitest run --config vitest.unit.config.ts server/workflow-ui-regression.test.ts
```

## 从需求生成案例

1. 写明入口、角色、资源范围及真正成功的事实。区分草稿、正式、归档和历史，明确谁能读取结果。用例用稳定编号关联需求、缺陷或设计。
2. 列出边界。文本包含中文、逗号、双引号、换行和超长值。数值包含空、零、临界值和越界。节点包含没有后继、多个后继和存量配置。按需求实际用到的类型选择。
3. 有状态的操作用状态转换表生成用例。包含首次成功、重复点击、响应不确定、版本冲突、排队后撤权、后台恢复、异常后重新打开。分别规定允许的终态及副作用次数。
4. 制作自足夹具。用唯一业务代号、两个角色和自己的对象 ID。需要第三方的用例保存供应商响应编号或业务回执，使用合成数据。历史脚本先核对目标、认证来源、是否改全局设置及是否能清理。写操作在明确选择的目标执行。
5. 固定观察方法。界面要操作控件并等待特定页面的标题、正文或状态。写入要刷新或在另一请求回读。只断言导航文案、HTTP 200 或 toast，无法验证实际业务结果。
6. 异步断言按业务承诺等待。使用本次 `runId`、`taskId`、`jobId` 轮询目标，设截止时间，超时打印脱敏状态。实例终态和作业完成分别观察。避免固定延时或无限重试掩盖失败。
7. 记录运行命令、Git/镜像身份、数据库版本、浏览器和视口、断言及原始材料位置。按“通过 / 失败 / 依赖阻塞 / 未执行”登记。数据库或供应商未连接时，该层保留未验状态。

## 结束一次验收

先核对创建、归档、删除和保留的夹具。远程保留审计行时写明数量和归属。将截图与脱敏报告放在 `.cache/`，对外的开发文档保留行为、复验步骤与验收门槛。出现失败，先确认测试使用的版本、目标、等待条件和夹具归属，再分别登记产品缺陷、验收脚本缺陷和环境限制。

## 验收脚本的目标与数据

历史 HTTP 与浏览器验收统一从 `FLOW_ACCEPTANCE_BASE_URL` 读取环境。写入确认 `FLOW_ACCEPTANCE_CONFIRM_WRITES` 必须等于该地址的精确 origin。远程测试使用 HTTPS，本机回环或专用隧道可用 HTTP。需要账号的脚本读取本次测试环境的用户名、密码。部分旧浏览器套件还会进入 Docker 准备夹具，这些套件必须指定同主机的 `FLOW_ACCEPTANCE_SSH_TARGET`、`FLOW_ACCEPTANCE_SSH_KEY`、`FLOW_ACCEPTANCE_APP_CONTAINER`，操作数据库容器的套件另需 `FLOW_ACCEPTANCE_MYSQL_CONTAINER`。确认全部指向专用环境再执行。

业务导入可以用 PowerShell 执行 `node scripts/project-import-browser-acceptance.cjs`。它真实登录、上传含 CRLF 的中文 CSV、校验非法输入零写入、重开批次、核对焦点及四种视口。生成的数据以本轮随机代号标识。路由、质量与指标三组从迁移后的全新数据库启动应用再分别运行，核对输出中的实例与场景。指标同时比对客户端实测耗时，Windows 与 UTC MySQL 分离部署也适用。

历史多角色浏览器套件 `test-multi-role-tiers.js` 使用目标隔离库内六个不同的专用身份。将 `FLOW_ACCEPTANCE_ROLE_USERS_FILE` 指向本机私有 UTF-8 JSON 文件。顶层 `origin` 填已确认的目标来源，`users` 下依次配置 `alice`、`bob`、`fiona`、`leo`、`clark`、`oscar`。每项填该环境实际的数字 `id`、`username`、`password`。文件仅授权测试执行者读取，保存在版本库外。四个历史浏览器入口的配置拦截回归见[入口用例](../../server/browser-acceptance-config.test.ts)。
