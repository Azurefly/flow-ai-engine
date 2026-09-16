#!/usr/bin/env bash
set -euo pipefail
cd /opt/flow-ai-engine/source
sudo docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" flow_ai_engine -N' <<'SQL'
SELECT CONCAT('test_users=',COUNT(*)) FROM users WHERE openId LIKE 'test:%';
SELECT CONCAT('test_projects=',COUNT(*)) FROM flow_project WHERE code LIKE '%TEST%' OR code LIKE 'P0_%' OR code LIKE 'P1_%';
SELECT CONCAT('test_workflows=',COUNT(*)) FROM workflow WHERE name LIKE '%测试%' OR name LIKE '%验收%';
SQL
