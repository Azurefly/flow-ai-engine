#!/usr/bin/env bash
set -euo pipefail

deploy_root="/opt/flow-ai-engine"
source_root="$deploy_root/source"
release_archive="/tmp/flow-ai-engine-9eac9eb.tar.gz"
test_override="/tmp/flow-ai-engine-iam-instance-test.yaml"
stamp="$(date +%Y%m%d-%H%M%S)-iam-workbench"
backup_root="$deploy_root/backups/$stamp"

cd "$source_root"
sudo install -d -o ubuntu -g ubuntu -m 750 "$backup_root"
tar --exclude=.env --exclude=node_modules --exclude=dist -czf "$backup_root/source-before.tar.gz" .
sudo docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers flow_ai_engine' | gzip > "$backup_root/mysql-before.sql.gz"
test -s "$backup_root/mysql-before.sql.gz"
gzip -t "$backup_root/mysql-before.sql.gz"
sudo docker image inspect flow-ai-engine:local >/dev/null
sudo docker tag flow-ai-engine:local "flow-ai-engine:backup-$stamp"

tar -xzf "$release_archive" -C "$source_root"
test -f "$source_root/.env"
test "$(stat -c '%a' "$source_root/.env")" = "600"
sudo docker compose config --quiet
sudo docker compose -f compose.yaml -f "$test_override" --profile test run --build --rm acceptance_test
sudo docker compose build app
sudo docker compose up -d app

for attempt in $(seq 1 24); do
  health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' flow-ai-engine-app-1)"
  if [ "$health" = "healthy" ]; then break; fi
  if [ "$attempt" = "24" ]; then sudo docker compose logs --tail=120 app; exit 1; fi
  sleep 5
done

curl --fail --silent --show-error http://127.0.0.1:1180/healthz
printf '%s\n' 9eac9eb | sudo tee "$deploy_root/DEPLOYED_COMMIT" >/dev/null
sudo docker compose ps
printf 'BACKUP_ROOT=%s\n' "$backup_root"
printf 'BACKUP_IMAGE=%s\n' "flow-ai-engine:backup-$stamp"
