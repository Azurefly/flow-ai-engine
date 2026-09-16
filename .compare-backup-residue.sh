#!/usr/bin/env bash
set -euo pipefail
cd /opt/flow-ai-engine/source
audit_db="flow_ai_engine_audit_130206"
mysql_cmd=(sudo docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"')
cleanup() {
  printf 'DROP DATABASE IF EXISTS `%s`;\n' "$audit_db" | "${mysql_cmd[@]}" >/dev/null
}
trap cleanup EXIT
printf 'DROP DATABASE IF EXISTS `%s`; CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n' "$audit_db" "$audit_db" | "${mysql_cmd[@]}" >/dev/null
gzip -dc /opt/flow-ai-engine/backups/20260823-130206-organization-v2/mysql-before.sql.gz | sudo docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" flow_ai_engine_audit_130206'
sudo docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" flow_ai_engine_audit_130206 -N' <<'SQL'
SELECT CONCAT('backup_test_users=',COUNT(*)) FROM users WHERE openId LIKE 'test:%';
SELECT CONCAT('backup_test_projects=',COUNT(*)) FROM flow_project WHERE code LIKE '%TEST%' OR code LIKE 'P0_%' OR code LIKE 'P1_%';
SELECT CONCAT('backup_test_workflows=',COUNT(*)) FROM workflow WHERE name LIKE '%测试%' OR name LIKE '%验收%';
SQL
