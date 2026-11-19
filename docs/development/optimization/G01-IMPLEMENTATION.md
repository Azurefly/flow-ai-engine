# G01　版本化数据输入与受控外部输出

数据资源的发布单位是不可变版本。流程节点保存完整版本 ID。同名文件可以上传多个版本，已发布流程仍然读取自己固定的字节。API 版本同时固定端点、相对路径、分页合同、字段映射和供应方数据集版本。写回版本指定单独的受管目标和唯一行键。

## 从业务页面使用

1. 在项目的服务端点中登记 HTTPS 基础地址、目标环境和凭据引用。密钥由部署者注入，带凭据的交换请求强制使用 HTTPS。项目资源页可分别登记 API 或文件数据源，再为它创建数据资源。
2. 在“资源配置中心 → 资源探查 → 登记资源版本”上传 UTF-8 CSV，或选择受管服务端点并填写 API 对端版本、行键、限额与字段映射。相同业务、资源、内容和声明的重复保存返回同一版本 ID。CSV 和 API 回执均有 SHA-256 摘要。
3. 在数据流程的资源节点或中间表节点选择资源并选择固定版本。字段选择作用于映射后的字段。资源版本和原始内容摘要可从运行节点输出及产物血缘回读。
4. 若需要写回，在输出节点选择“预览并确认外部写回”并选择写回版本。运行先验证行唯一键，保存预览、原始结果摘要和操作键。草稿测试、调度和未通过运行仅可查看。成功的手动正式运行可由当前项目管理者在实例详情核对目标、行数、样本和摘要，再确认写入。
5. 结果不确定时在原实例核对同一操作。服务先查询目标回执，目标尚无该键的记录才会依合同提交。目标须以同一键原子保存数据和回执。旧定义的 `audit_only` 继续只记录运行。

## 供应方合同

| 端点 | 参数、结果与限制 |
| --- | --- |
| 分页读取 | 对登记的相对路径发 GET。首请求带 `version`，后续增加不透明的 `cursor`。200 返回对象 `{version, rows, nextCursor}`。末页的 `nextCursor` 为 null。每页的 version 必须等于登记值。供应方应提供稳定排序和固定快照。 |
| 行键与映射 | 唯一行键是原始行的字符串或数值，跨页不能重复。字段映射的键为输出字段、值为输入字段。节点的行数上限可提前停止分页，版本页数、原始行数和响应字节上限用于拒绝超过预算的输入。 |
| 文件输入 | UTF-8 CSV 支持 BOM、双引号、嵌入 CRLF、中文、空字段。标题须唯一且非空。上传后原始对象保存在业务版本表内，摘要按原始字节计算。单文件最多 512 KiB、1000 行、100 列。非法内容在事务前定位行列。 |
| 查询回执 | 对登记的写回路径下的 `/<operationKey>` 发 GET。目标对确实未提交的操作返回 404。成功返回 `{operationKey,payloadHash,rowCount,receipt}`。 |
| 写回 | 对同一路径发 POST，带 `Idempotency-Key`，JSON 包含 `operationKey, payloadHash, rows`。目标必须保证相同键与相同内容只产生一次业务副作用，内容冲突返回 409。摘要按 UTF-8 JSON 递归排序对象键，数组保留顺序。 |
| 目标范围 | 只接受当前项目启用的受管端点。固定版本记录基础 URL，后续地址变化须创建新版本。传输复用已有 DNS 固定、目标地址、端口、重定向和响应上限检查。部署配置可通过 `FLOW_DATA_CONNECTOR_DISABLED` 单独关闭 `api_read,file_read,receipt_write` 中的操作。 |

## 持久化与恢复

- `data_connector_version` 保留资产、数据源、内容摘要及合同。CSV 字节只在运行时按精确版本取出。版本有引用的资源应停用，项目和实例仍保留历史。
- `data_connector_page` 用实例、节点、页序作为主键。每个新请求前、接收结果提交前均复查有效用户、业务权限、作业租约和版本。每页在独立事务记录入出游标、数据、字节数和摘要。重领时回放已提交页并从其游标续读。取消、失败终态、节点产物提交后释放临时行，保留摘要与页级元数据。
- `data_connector_write` 用实例、节点、固定版本的摘要作操作键。预览与节点产物在同一事务提交。确认时复查当前管理权、会话、正式运行和版本，保存确认人。确认后响应中断可按键核对、恢复回执。目标凭据始终由项目已登记的端点解析。
- 迁移采用 `0049_governed_capabilities`。关闭新操作后保留版本、已完成实例及回执。历史 API 连通测试与文件登记仍可使用。

## 复验

Windows PowerShell 在仓库根目录执行类型检查与单元测试。数据库集成前将 `DATABASE_URL` 指向已迁移的专用测试库。用例会新建自己的账号、业务和流程，结束后归档业务并撤销测试会话。

```powershell
pnpm check
pnpm exec vitest run --config vitest.unit.config.ts server/data-connector-contract.test.ts server/dataflow-resource-readiness.test.ts server/vite-dev-entry.test.ts
pnpm exec vitest run --config vitest.mysql.config.ts server/versioned-data-connectors.integration.test.ts
```

独立交换对端使用 Node 22 运行 `scripts/data-connector-exchange.mjs`。服务从 `FLOW_EXCHANGE_TENANT`、`FLOW_EXCHANGE_TOKEN_FILE`、`FLOW_EXCHANGE_STATE_DIR` 获取专用租户标识、只读令牌文件与持久目录。监听回环地址，端口取自 `FLOW_EXCHANGE_PORT`，默认 18481。通过带可信证书的反向代理仅转发 `/g01/<tenant>/`。设置 `FLOW_EXCHANGE_FAULTS=1` 会使该租户第二页首次返回 503，并在目标业务写入成功后中断首次提交响应。

联测程序 `scripts/data-connector-acceptance.mjs` 需要显式应用 origin、写入确认、环境提供的测试登录、完整对端租户 URL 和同值的 `FLOW_EXCHANGE_CONFIRM_TARGET`。令牌通过只读文件取得，应用用 `FLOW_EXCHANGE_SECRET_REF` 指向同一项目端点凭据。对端开放 `rows`、`sample.csv`、`receipts/<key>`、`objects/<key>` 与合成数据计数 `counters`。脚本逐行比较目标实际业务对象，检查回执、摘要与唯一业务写入数。新租户可设 `FLOW_EXCHANGE_EXPECT_FAULTS=1` 检查第 2 页恢复时没有重读第 1 页。脚本结束时核对测试业务及流程数，然后归档。

浏览器复验使用 `node scripts/data-connector-browser-acceptance.cjs`。先按[测试约束](../testing.md)指出应用目标、写入确认及专用账号。脚本实际启动 Edge、登记文件、发起运行并核对监控结果。开发模式从项目的 Vite 配置加载客户端根路径。两条脚本归档自己创建的业务，保留关联审计行。

| 场景 | 可复核证据 |
| --- | --- |
| A51 | 真实 MySQL，首轮接收第 1 页后第 2 页超时；重领时请求序列为 0、1、1、2；页、行、字节三个限额分别进入明确的失败终态。 |
| A52 | 真实 Edge 在资源探查登记并上传带 BOM、中文逗号、嵌入 CRLF 的 CSV，回读文件摘要，在实例监控看到实际运行行。真实 MySQL 另验同名新旧版本、运行中撤销操作员与取消在途页。 |
| A53 | 真实 MySQL 记录预览与操作，传输替身模拟目标写入成功后断连，回查和重复确认始终指向原回执。目标明确返回 422 时保留拒绝状态，再次确认仍只发送一次。独立对端联测另外回读实际业务对象。 |
| A54 | 环境专属的真实 HTTP 与外部交换回执、测试项目归档、发布源码和镜像身份统一登记于[本轮实施记录](IMPLEMENTATION.md)。 |

实现入口见[合同与 CSV 解析](../../../server/data-connector-contract.ts)、[持久化与传输](../../../server/versioned-data-connectors.ts)、[tRPC 注册](../../../server/data-connector-router.ts)、[表定义](../../../drizzle/data-connector-schema.ts)、[集成测试](../../../server/versioned-data-connectors.integration.test.ts)和[独立对端验收](../../../scripts/data-connector-acceptance.mjs)。
