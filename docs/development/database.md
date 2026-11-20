# 数据库与迁移约束

数据库基线是 MySQL 8.4。Drizzle 的[表结构](../../drizzle/schema.ts)、[迁移账本](../../drizzle/meta/_journal.json)、对应 SQL 与快照共同描述可发布的数据库结构。[运行诊断](../../server/runtime-info.ts)还维护部署启动时需要校验的迁移信息。先读最新账本再取下一个编号。

应用数据库连接统一用 UTC。MySQL 会话在交给查询前设为 `+00:00`，驱动以 UTC 解释传入和返回的时间。角色到期、运行筛选及调度均按绝对时刻比较，页面用浏览器时区显示。原生数据调度的 `nextRunAt` 也以 UTC 写入。外部数据源连接遵循该数据源自身的时间约定。[连接池](../../server/db.ts) · [真实 MySQL 回归](../../server/db-time.integration.test.ts)

## 变更流程

1. 列出受影响的表、唯一约束、索引、空值、默认值，以及仍在运行的旧 worker 和历史实例。用真实样本说明旧行如何在新逻辑中读取。
2. 在专用开发库生成和检查 SQL、对应快照和 journal。`package.json` 的 `db:push` 实际依次执行 `drizzle-kit generate` 和 `drizzle-kit migrate`。只验收已有迁移时使用 `pnpm exec drizzle-kit migrate`。执行前确认 `DATABASE_URL` 指向本轮隔离库，避免输出连接口令。
3. 已应用的迁移保留原始字节。项目通过 [.gitattributes](../../.gitattributes)固定迁移 SQL 和 Shell 的 LF。新修订用新的迁移记录。大表变更评估锁时长、回填批次、索引命中和旧客户端兼容性。
4. 对需要数据库就绪校验的改动，联动核对 runtime 常量和[迁移完整性用例](../../server/migration-integrity.test.ts)。只有字段仍兼容才可直接回滚应用镜像，破坏性迁移另列恢复方案。

## 验证矩阵

| 数据库起点 | 操作 | 通过条件 |
| --- | --- | --- |
| 空的专用 MySQL 8.4 | 执行迁移，再执行一次 | 表、索引和默认值齐全，第二次运行的账本没有新增重复记录 |
| 上一发布版 + 合成存量业务 | 升级到候选版 | 历史流程定义、实例快照、有效成员及任务仍可读取，回填计数符合预期 |
| 当前版 + 两个独立连接 | 并发撤回与办理、并发筛重或授权变更 | 事务只有合法结果，审计与业务一致。重试沿用同一逻辑操作 |
| 授权的恢复演练环境 | 用备份和对应配置恢复 | 校验迁移账本、健康状态、业务样本和需要的独立密钥，记录恢复时间 |

MySQL 的真实锁、事务与 JSON 行为使用 `vitest.mysql.config.ts` 验证。共享系统设置的测试文件按现有配置串行执行。生产备份、恢复命令和镜像身份核验见[部署说明](../deployment-linux-docker.md)。本地 PowerShell 与远程 Linux Bash 分开执行。
