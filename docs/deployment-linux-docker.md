# Linux Docker 部署

升级到 `0049_governed_capabilities` 时，核对候选镜像内的迁移字节和现有数据库备份。此版为父子流程、助手回合、外部连接器和内部目录增加持久回执。需要回退时先停止新增接单，保留能够处理在途回执的消费者，核对待确认写回和子实例，随后切换兼容镜像。具体配置、外部联测命令和逐项收尾条件见[数据连接器](development/optimization/G01-IMPLEMENTATION.md)、[父子流程](development/optimization/G02-IMPLEMENTATION.md)、[内部目录](development/optimization/G03-IMPLEMENTATION.md)及[助手作业](development/optimization/G04-IMPLEMENTATION.md)。

## 低内存服务器构建

应用部署脚本要求本机编译前至少有 2 GiB 可用内存。内存不足时，在独立构建机生成镜像，通过 `docker image save` 导出，再把镜像包和同一提交的源码归档上传到部署服务器。

通过 `FLOW_PREBUILT_IMAGE_TAR` 指定服务器上的镜像包绝对路径，通过 `FLOW_PREBUILT_IMAGE_SHA256` 提供 SHA256。脚本校验镜像包摘要、镜像内的源码指纹和构建时间，再继续应用切换和健康检查。数据库备份与容器一致性检查仍然执行。构建失败或摘要不匹配时，运行中的应用不切换。

在 Linux 构建机的 Bash 中，从同一提交的干净源码目录构建：

```bash
SOURCE_HASH="$(bash scripts/source-fingerprint.sh)"
BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
docker build --build-arg "BUILD_ID=source-$SOURCE_HASH" --build-arg "BUILD_TIME=$BUILD_TIME" -t flow-ai-engine:local .
docker image save --output /tmp/flow-ai-engine-image.tar flow-ai-engine:local
sha256sum /tmp/flow-ai-engine-image.tar
```

镜像包放在部署源码目录之外，上传后再次核对摘要，并在远程 Linux Bash 中执行：

独立构建机需要代理时，可给 `docker build` 追加 `HTTP_PROXY`、`HTTPS_PROXY` 构建参数，并设置 `--build-arg 'BUILD_NODE_OPTIONS=--max-old-space-size=768 --use-env-proxy'`。该参数仅作用于构建阶段，不进入应用运行环境。

```bash
sudo env FLOW_COMPOSE_ENV_FILE=/opt/flow-ai-engine/source/.env \
  FLOW_PREBUILT_IMAGE_TAR=/tmp/flow-ai-engine-image.tar \
  FLOW_PREBUILT_IMAGE_SHA256=替换为镜像包的SHA256 \
  bash scripts/deploy-app.sh
```

## 目标

- Compose 将应用 HTTP 端口绑定到宿主回环地址。公网登录由 Nginx 终止 TLS。
- MySQL 只连接独立内部 Docker 网络，不向宿主机暴露 3306。
- 数据保存在 Compose 命名卷 `flow-ai-engine_flow_ai_mysql_data`。
- 应用启动前运行版本化 Drizzle 迁移。
- 应用以非 root、只读根文件系统运行，仅 `/tmp` 可写。

## 首次部署

在部署目录创建权限为 600 的 `.env`，至少设置：

- `MYSQL_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `FLOW_BOOTSTRAP_ADMIN_USERNAME`
- `FLOW_BOOTSTRAP_ADMIN_PASSWORD`（至少 12 个字符）

然后执行：

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

不要将真实 `.env` 提交到 Git。

## 升级

在远程 Linux 服务器的当前源码目录使用部署脚本，沿用现有环境配置：

```bash
FLOW_COMPOSE_ENV_FILE=/opt/flow-ai-engine/source/.env bash scripts/deploy-app.sh
```

脚本先创建私有数据库备份并校验 gzip 完整性，再更新应用；MySQL 容器和数据卷保持不变。应用健康或镜像身份校验失败时会恢复旧镜像。

部署脚本生成的数据库备份只保留最新一份。新备份校验成功后清理旧的脚本备份；不自动删除无法确认归属的历史目录。应用更新成功后，清理未被任何容器引用的 `flow-ai-engine` 旧镜像，保留当前运行镜像。清理不会使用强制镜像删除或删除数据卷。

`docker compose up -d` 不会删除命名卷。禁止使用 `docker compose down -v`，除非已经明确确认需要永久删除数据库。

## 在同一公网端口提供 HTTPS

主机已有为站点名或 IP 签发的有效证书时，可沿用当前公网端口。在远程 Linux 主机的 Compose 环境文件设置 `FLOW_HTTP_BIND_ADDRESS=127.0.0.1`、`FLOW_HTTP_PORT=1181`，为外部 Nginx 留出 1180。Docker 容器健康检查继续使用容器自身的 3000。保留既有数据库卷、应用镜像摘要、启动环境和加密密钥，先备份配置并在回环监听器测试。

[站点模板](../scripts/nginx/flow-https.conf.template)会把原端口上的明文 GET/HEAD 升级为 HTTPS，以 426 拒绝明文写请求。将下例的站点名和证书目录替换为证书实际覆盖的名称与目录。在项目根目录的 Linux Bash 执行，显式变量清单保留模板中的 Nginx 变量。

```bash
export FLOW_PUBLIC_HOST=flow.example.org FLOW_TLS_PORT=1180 FLOW_HTTP_PORT=1181
export FLOW_CERT_DIR=/etc/letsencrypt/live/flow.example.org
envsubst '${FLOW_PUBLIC_HOST} ${FLOW_TLS_PORT} ${FLOW_HTTP_PORT} ${FLOW_CERT_DIR}'   < scripts/nginx/flow-https.conf.template > /tmp/flow-https.conf
sudo install -m 0644 /tmp/flow-https.conf /etc/nginx/conf.d/flow-ai-engine-https.conf
sudo nginx -t
```

确认回环上游就绪后 reload Nginx。以独立客户端核对证书和跳转，使用测试身份登录、刷新和注销。证书续期时沿用现有 ACME 续期机制，并在更新后 reload Nginx。回退应用版本时保留 TLS 站点和回环上游，必要时恢复之前有效的站点配置并重新检查语法。

**同机演练第二个 Nginx 实例时，给它独立的临时目录。** Linux 上 `nginx -p` 可以重定向相对路径，发行版在编译时设定的绝对临时目录仍可能被两个主进程共用。先确认服务的 worker 用户，给演练实例指定独立的 PID、日志、监听端口，以及 `client_body_temp_path`、`proxy_temp_path`、`fastcgi_temp_path`、`uwsgi_temp_path`、`scgi_temp_path`。每个目录由演练 worker 可访问。演练前后核对正式目录的属主与权限。

发布验收应从公网读完上线镜像中的静态资源，比较完整字节数和 SHA-256，再用新浏览器会话登录与注销。本站曾在 `/readyz` 成功、JavaScript 请求返回 200 的情况下截断大响应。定位时分别读取容器文件、主机回环上游和公网文件，并检查 Nginx 错误日志中的代理临时目录。若正式目录属主与正式 worker 不符，核对正式配置，执行其 `nginx -t` 和标准服务 reload，再复验完整文件。[本轮发布回执](development/optimization/IMPLEMENTATION.md#远程发布回执)

站点模板在应用的 `location /` 中设置 `proxy_max_temp_file_size 0`，使反向代理使用有界内存缓冲传送响应。工作台列表和实例详情的响应可能超过该缓冲区。迁移已有站点时，把同一条指令补到应用代理位置，保留该站点已有的代理路由，再检查配置并 reload。验收时在桌面浏览器反复前进、后退，确认实例详情和节点记录完整加载，同时检查 `workflow.runDetail` 和 `task.instancePage` 对应的日志有没有临时文件写入失败。[Nginx 指令说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_max_temp_file_size)

## 验证

```bash
curl --fail "http://127.0.0.1:${FLOW_HTTP_PORT:-1180}/readyz"
curl --fail "https://${FLOW_PUBLIC_HOST}:${FLOW_TLS_PORT:-1180}/healthz"
docker compose ps
docker compose logs --tail=100 app
```

HTTP 和容器健康只代表基础可用；完整验收还需要真实登录、创建项目/流程、保存定义、运行流程，并在容器重启后确认数据仍存在。
