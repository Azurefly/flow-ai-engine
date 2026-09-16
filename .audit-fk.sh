#!/usr/bin/env bash
set -euo pipefail
cd /opt/flow-ai-engine/source
sudo docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" information_schema -N' <<'SQL'
SELECT CONCAT(TABLE_NAME,'.',COLUMN_NAME,' -> ',REFERENCED_TABLE_NAME,'.',REFERENCED_COLUMN_NAME)
FROM KEY_COLUMN_USAGE
WHERE REFERENCED_TABLE_SCHEMA='flow_ai_engine'
  AND REFERENCED_TABLE_NAME IN ('users','flow_project','workflow','workflow_run','workflow_task')
ORDER BY REFERENCED_TABLE_NAME,TABLE_NAME,COLUMN_NAME;
SQL
