#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT/compose.yaml"
COMPOSE_ENV_FILE="${FLOW_COMPOSE_ENV_FILE:-/opt/flow-ai-engine/source/.env}"
SECRET_DIR="${FLOW_SECRET_DIR:-/opt/flow-ai-engine/secrets}"
BACKUP_ROOT="${FLOW_BACKUP_ROOT:-$(dirname "$ROOT")/backups}"
IMAGE_NAME="flow-ai-engine:local"
APP_SERVICE="app"
MYSQL_SERVICE="mysql"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -f "$COMPOSE_FILE" ]] || die "Missing Compose file: $COMPOSE_FILE"
[[ -f "$COMPOSE_ENV_FILE" ]] || die "Missing Compose environment file: $COMPOSE_ENV_FILE"
[[ "$SECRET_DIR" == /* ]] || die "FLOW_SECRET_DIR must be an absolute path"
command -v docker >/dev/null 2>&1 || die "Docker CLI is required"
command -v find >/dev/null 2>&1 || die "find is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
command -v gzip >/dev/null 2>&1 || die "gzip is required"

if sudo -n test -L "$SECRET_DIR"; then
  die "Runtime secret directory must not be a symlink"
elif sudo -n test -e "$SECRET_DIR"; then
  sudo -n test -d "$SECRET_DIR" || die "Runtime secret path must be a directory"
  sudo -n chown root:1000 -- "$SECRET_DIR"
  sudo -n chmod 0750 -- "$SECRET_DIR"
else
  sudo -n install -d -o root -g 1000 -m 0750 -- "$SECRET_DIR"
fi

while IFS= read -r -d '' secret_path; do
  secret_name="${secret_path##*/}"
  [[ "$secret_name" =~ ^FLOW_SECRET_[A-Z0-9_]{2,128}$ ]] || die "Runtime secret filenames must match FLOW_SECRET_*"
  sudo -n test -f "$secret_path" || die "Runtime secrets must be regular files"
  sudo -n test ! -L "$secret_path" || die "Runtime secret files must not be symlinks"
  sudo -n chown root:1000 -- "$secret_path"
  sudo -n chmod 0440 -- "$secret_path"
done < <(sudo -n find "$SECRET_DIR" -mindepth 1 -maxdepth 1 -print0)

cd "$ROOT"
SOURCE_HASH="$({
  find . \
    \( -type d \( -name .git -o -name .cache -o -name node_modules -o -name dist -o -name docs -o -name reference-analysis-temp \) -prune \) -o \
    \( -type f \( -name .env -o \( -name '.env.*' ! -name .env.example \) -o -name '*.log' \) -prune \) -o \
    -type f -print0
} | LC_ALL=C sort -z | xargs -0 -r sha256sum | sha256sum | awk '{print $1}')"
[[ "$SOURCE_HASH" =~ ^[a-f0-9]{64}$ ]] || die "Could not compute the source fingerprint"

BUILD_ID="source-$SOURCE_HASH"
BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
RELEASE_TAG="flow-ai-engine:release-${SOURCE_HASH:0:16}-${BUILD_TIME//:/-}"

compose() {
  sudo -n env \
    BUILD_ID="$BUILD_ID" \
    BUILD_TIME="$BUILD_TIME" \
    IMAGE_ID="${IMAGE_ID:-not-injected}" \
    FLOW_SECRET_DIR="$SECRET_DIR" \
    docker compose \
      --project-directory "$ROOT" \
      --env-file "$COMPOSE_ENV_FILE" \
      -f "$COMPOSE_FILE" \
      "$@"
}

printf 'Validating Docker Compose configuration.\n'
compose config --quiet || die "Docker Compose configuration validation failed"

docker_sudo() {
  sudo -n docker "$@"
}

create_database_backup() {
  local mysql_id="$1"
  local health data_bytes required_free_bytes available_bytes
  local backup_stamp backup_dir backup_file backup_partial backup_sha256 backup_bytes

  health="$(docker_sudo inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$mysql_id")"
  [[ "$health" == healthy ]] || die "MySQL is not healthy; refusing to deploy"

  data_bytes="$(docker_sudo exec "$mysql_id" sh -c '
    set -eu
    : "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
    : "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
    export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
    exec mysql --user=root --batch --skip-column-names --database="$MYSQL_DATABASE" \
      --execute="SELECT COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
  ')" || die "Could not estimate MySQL size; refusing to deploy"
  [[ "$data_bytes" =~ ^[0-9]+$ ]] || die "MySQL returned an invalid data-size estimate"

  sudo -n install -d -m 0700 -- "$BACKUP_ROOT"
  available_bytes="$(df -PB1 "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')"
  [[ "$available_bytes" =~ ^[0-9]+$ ]] || die "Could not verify backup storage capacity"
  required_free_bytes=$((data_bytes + data_bytes / 2 + 67108864))
  ((available_bytes >= required_free_bytes)) || die "Insufficient free space for a safe MySQL backup"

  backup_stamp="${BUILD_TIME//:/-}"
  backup_dir="$BACKUP_ROOT/ui-${backup_stamp}-${SOURCE_HASH:0:12}-$$"
  if sudo -n test -e "$backup_dir"; then
    die "Backup directory already exists: $backup_dir"
  fi
  sudo -n install -d -m 0700 -- "$backup_dir"
  backup_file="$backup_dir/mysql-${backup_stamp}.sql.gz"
  backup_partial="$backup_file.partial"

  printf 'Creating private MySQL backup before app migration.\n'
  if ! docker_sudo exec "$mysql_id" sh -c '
    set -eu
    : "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
    : "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
    export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
    exec mysqldump --user=root --single-transaction --routines --triggers --databases "$MYSQL_DATABASE"
  ' | gzip -1 -c | sudo -n tee "$backup_partial" >/dev/null; then
    die "MySQL backup failed; app service was not changed"
  fi

  sudo -n chmod 0600 -- "$backup_partial"
  sudo -n gzip -t -- "$backup_partial" || die "MySQL backup verification failed; app service was not changed"
  sudo -n mv -- "$backup_partial" "$backup_file"
  backup_sha256="$(sudo -n sha256sum "$backup_file" | awk '{print $1}')"
  backup_bytes="$(sudo -n stat -c '%s' "$backup_file")"
  printf 'MySQL backup verified: bytes=%s sha256=%s path=%s\n' \
    "$backup_bytes" "$backup_sha256" "$backup_file"
}

wait_for_app_health() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
  local app_id state
  while (( $(date +%s) < deadline )); do
    app_id="$(compose ps -q "$APP_SERVICE" 2>/dev/null || true)"
    if [[ -n "$app_id" ]]; then
      state="$(docker_sudo inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_id" 2>/dev/null || true)"
      if [[ "$state" == healthy ]]; then
        return 0
      fi
      if [[ "$state" == unhealthy || "$state" == exited || "$state" == dead ]]; then
        return 1
      fi
    fi
    sleep 5
  done
  return 1
}

verify_runtime_identity() {
  local app_id running_image
  app_id="$(compose ps -q "$APP_SERVICE")"
  [[ -n "$app_id" ]] || return 1
  running_image="$(docker_sudo inspect --format '{{.Image}}' "$app_id")"
  [[ "$running_image" == "$IMAGE_ID" ]] || {
    printf 'Runtime image ID mismatch: expected %s, got %s\n' "$IMAGE_ID" "$running_image" >&2
    return 1
  }
  docker_sudo exec \
    --env EXPECTED_BUILD_ID="$BUILD_ID" \
    --env EXPECTED_BUILD_TIME="$BUILD_TIME" \
    --env EXPECTED_IMAGE_ID="$IMAGE_ID" \
    "$app_id" node -e '
    const expected = {
      buildId: process.env.EXPECTED_BUILD_ID,
      buildTime: process.env.EXPECTED_BUILD_TIME,
      imageId: process.env.EXPECTED_IMAGE_ID,
    };
    fetch("http://127.0.0.1:3000/readyz")
      .then(async response => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        const actual = {
          buildId: process.env.BUILD_ID,
          buildTime: process.env.BUILD_TIME,
          imageId: process.env.IMAGE_ID,
        };
        const matched = Object.keys(expected).every(key => expected[key] === actual[key]);
        console.log(JSON.stringify({ ready: body.ready, runtime: actual }));
        if (!response.ok || !body.ready || !matched) process.exit(1);
      })
      .catch(() => process.exit(1));
  '
}

MYSQL_BEFORE_ID="$(compose ps -q "$MYSQL_SERVICE")"
[[ -n "$MYSQL_BEFORE_ID" ]] || die "MySQL service is not running; refusing an app-only deployment"
MYSQL_BEFORE_STARTED="$(docker_sudo inspect --format '{{.State.StartedAt}}' "$MYSQL_BEFORE_ID")"
create_database_backup "$MYSQL_BEFORE_ID"
APP_BEFORE_ID="$(compose ps -q "$APP_SERVICE" 2>/dev/null || true)"
PREVIOUS_IMAGE_ID=""
ROLLBACK_TAG=""
if [[ -n "$APP_BEFORE_ID" ]]; then
  PREVIOUS_IMAGE_ID="$(docker_sudo inspect --format '{{.Image}}' "$APP_BEFORE_ID")"
  ROLLBACK_TAG="flow-ai-engine:rollback-${BUILD_TIME//:/-}"
  docker_sudo image tag "$PREVIOUS_IMAGE_ID" "$ROLLBACK_TAG"
fi

printf 'Building %s at %s\n' "$BUILD_ID" "$BUILD_TIME"
compose build "$APP_SERVICE"
IMAGE_ID="$(docker_sudo image inspect --format '{{.Id}}' "$IMAGE_NAME")"
[[ "$IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || die "Docker returned an invalid image ID"
docker_sudo image tag "$IMAGE_ID" "$RELEASE_TAG"

compose up -d --no-deps --force-recreate "$APP_SERVICE"
if ! wait_for_app_health; then
  printf 'New app image did not become healthy within %s seconds.\n' "$HEALTH_TIMEOUT_SECONDS" >&2
  if [[ -n "$PREVIOUS_IMAGE_ID" ]]; then
    printf 'Restoring previous app image %s.\n' "$PREVIOUS_IMAGE_ID" >&2
    docker_sudo image tag "$PREVIOUS_IMAGE_ID" "$IMAGE_NAME"
    IMAGE_ID="$PREVIOUS_IMAGE_ID"
    compose up -d --no-deps --force-recreate "$APP_SERVICE"
    wait_for_app_health || die "Automatic rollback did not become healthy; previous image tag: $ROLLBACK_TAG"
  fi
  die "App deployment failed health verification"
fi

verify_runtime_identity || {
  printf 'Runtime build identity verification failed.\n' >&2
  if [[ -n "$PREVIOUS_IMAGE_ID" ]]; then
    docker_sudo image tag "$PREVIOUS_IMAGE_ID" "$IMAGE_NAME"
    IMAGE_ID="$PREVIOUS_IMAGE_ID"
    compose up -d --no-deps --force-recreate "$APP_SERVICE"
    wait_for_app_health || die "Automatic rollback did not become healthy; previous image tag: $ROLLBACK_TAG"
  fi
  die "Runtime identity mismatch"
}

MYSQL_AFTER_ID="$(compose ps -q "$MYSQL_SERVICE")"
[[ "$MYSQL_AFTER_ID" == "$MYSQL_BEFORE_ID" ]] || die "MySQL container identity changed during app-only deployment"
MYSQL_AFTER_STARTED="$(docker_sudo inspect --format '{{.State.StartedAt}}' "$MYSQL_AFTER_ID")"
[[ "$MYSQL_AFTER_STARTED" == "$MYSQL_BEFORE_STARTED" ]] || die "MySQL container restarted during app-only deployment"

printf 'Deployment verified: service=%s imageId=%s release=%s mysqlContainerUnchanged=true\n' \
  "$APP_SERVICE" "$IMAGE_ID" "$RELEASE_TAG"
if [[ -n "$ROLLBACK_TAG" ]]; then
  printf 'Rollback image retained: %s\n' "$ROLLBACK_TAG"
fi
