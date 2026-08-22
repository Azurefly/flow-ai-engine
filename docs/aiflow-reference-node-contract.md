# 原版节点配置契约与安全迁移

## 证据来源

- 前端默认值：`assets/js/canvas/canvas.js`（节点创建配置）。
- 前端保存映射：`assets/js/designProcess/canvas_operate.js`。
- 属性模板：`assets/template/design_process/configuration-*.tpl`。
- 后端节点类型：`FlowEnginServer-dev` 的 `FlowNodeType.java`。
- 后端反序列化：`FlowNodeDeserializer.java`。

当前统一实现位于 `shared/workflow-node-contract.ts`。导入历史定义时只填补缺失的已知默认值，不删除未知字段。

## 节点与原版字段

| 当前类型 | 原版类型 | 原版已确认字段 | 当前执行边界 |
|---|---|---|---|
| `start` | `START` | 开始节点结构 | 初始化输入变量。 |
| `end` | `END` | 结束节点结构 | 输出受限模板结果。 |
| `state` | `STATE` | `nodeDh`、`jdmc`、`bdjs`、`jdgycz`、`ywcz`、`stateColor` | 输出状态代号、名称、类型和展示字段。 |
| `operate` | `OPERATE` | `nodeDh`、`czmc`、`lsWorkZone`、`bddxcrjsrsx`、`bdczcrjsrsx`、`qxkz`、`bddx`、`bdcz`、`sxsz`、`fsfsz`、`jsfsz`、`zdzx` | 创建当前系统人工任务；旧任意代码不执行。 |
| `router` | `ROUTER` | `nodeDh`、`lymc`、`gbms`、`lysz` | 当前 `routes` 条件 DSL 可执行；`lysz` 原任意代码仅保存。 |
| `rest` | `REST` | `nodeDh`、`restmc`、`restType`、`restApi`、`restHeaderParam`、`restGetBodyParam`、`restJsonParam`、`restAttributeMap`、`restScriptCode` | 转换到受限 HTTP 执行器。 |
| `method` | `METHOD` | 与 REST 相同 | 原后端使用 `RestNode`；当前复用同一安全执行器。 |
| `subflow` | `CHILD` | `zlcxz`、`nodeDh`、`sfgqzlc`、`zlcfqf`、`gdtj`、`zlcrk`、`zlcck` | 必须映射为当前所有者的已启用私有 `subflowId`。 |
| `sql` | `SQL` | SQL 节点配置 | 继续执行当前只读 SQL 与数据源隔离策略。 |

## 兼容别名

| 原版字段 | 当前兼容字段 | 读取/保存原则 |
|---|---|---|
| `state.nodeDh` | `stateCode` | 优先原版非空值；保留两者。 |
| `state.jdmc` | `displayName` | 优先原版非空值；保留两者。 |
| `operate.nodeDh` | `commandCode` | 验证任一非空即可。 |
| `rest.restApi` | `endpoint` / `url` | 执行前统一映射，不改写持久化原值。 |
| `rest.restType` | `method` | 转为大写并限制在 GET/POST/PUT/PATCH/DELETE。 |
| `rest.restHeaderParam` | `headers` | 兼容键值数组与对象。 |
| `rest.restJsonParam` | `body` | 原版非空时优先；合法 JSON 转对象，否则保持文本。 |

## REST/方法安全映射

1. 在模板解析后构造 URL、查询参数、请求头和请求体。
2. DNS 解析后拒绝本机、私网、环回、链路本地和保留地址。
3. 只允许 HTTP/HTTPS 及 80/443 端口，拒绝 URL 凭据。
4. 拒绝自动重定向，限制请求超时和 1 MB 响应。
5. 剔除调用方不可控制的 Host、Connection、Content-Length。
6. `restScriptCode` 和旧响应校验代码不在主进程执行。

## 明确未完成的等价迁移

- `operate.qxkz`、`bddx`、`bdcz`、`sxsz`、`fsfsz`、`jsfsz`、`zdzx` 尚需专用字段化编辑器和当前 IAM 映射。
- `router.lysz` 尚需转换为受限条件 DSL；无法转换时必须阻止发布/执行并说明具体规则。
- `subflow.zlcxz.id` 不能直接当作当前 `subflowId`，需要显式迁移映射和所有者校验。
- `restScriptCode` 后续只能在资源受限的隔离沙箱执行。

当前通用结构化编辑器已经支持递归对象和数组，能够无损查看、修改及新增上述深层配置；“尚需专用字段化编辑器”指仍需补充领域标签、选择器、约束和 IAM 语义，而不是要求用户退回 JSON 文本编辑。

当前可执行定义校验已经落实阻断：操作节点存在尚未映射的原版权限/绑定/自动执行配置、路由节点只有 `lysz` 而没有安全 `routes` 映射，或 REST/方法节点启用 `restScriptCode`/响应校验时，草稿仍可保存，但发布和运行会返回明确迁移错误。

## 自动验证

- `server/workflow-node-contract.test.ts`：默认值、证据级别、原版/兼容字段校验和未知字段保留。
- `server/workflow-engine.test.ts`：GET 参数、键值请求头、JSON 请求体、当前字段兼容和 SSRF。
- `server/workflow-ui-regression.test.ts`：方法节点、布尔字段、REST 键值行编辑和详情页顺序。
