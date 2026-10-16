# Linux Docker 部署

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

- 应用通过宿主机端口 `1180` 提供服务。
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

## 验证

```bash
curl --fail http://127.0.0.1:1180/
curl --fail http://127.0.0.1:1180/healthz
docker compose ps
docker compose logs --tail=100 app
```

HTTP 和容器健康只代表基础可用；完整验收还需要真实登录、创建项目/流程、保存定义、运行流程，并在容器重启后确认数据仍存在。
