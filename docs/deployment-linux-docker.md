# Linux Docker 部署

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

升级前先备份数据库：

```bash
mkdir -p backups
docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers flow_ai_engine' | gzip > "backups/flow_ai_engine-before-upgrade.sql.gz"
```

确认备份文件非空后再更新源代码：

```bash
docker compose build
docker compose up -d
docker compose ps
```

`docker compose up -d` 不会删除命名卷。禁止使用 `docker compose down -v`，除非已经明确确认需要永久删除数据库。

## 验证

```bash
curl --fail http://127.0.0.1:1180/
curl --fail http://127.0.0.1:1180/healthz
docker compose ps
docker compose logs --tail=100 app
```

HTTP 和容器健康只代表基础可用；完整验收还需要真实登录、创建项目/流程、保存定义、运行流程，并在容器重启后确认数据仍存在。
