#!/usr/bin/env bash
set -Eeuo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fixture="$(mktemp -d /tmp/flow-backup-retention.XXXXXX)"
[[ "$fixture" == /tmp/flow-backup-retention.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
root="$fixture/backups"
old="$root/ui-2026-10-02T09-03-31Z-aaaaaaaaaaaa-1"
keep="$root/ui-2026-10-03T13-32-46Z-bbbbbbbbbbbb-2"
mkdir -p "$old" "$keep" "$root/legacy-unknown"
printf 'SELECT 1;\n' | gzip > "$old/mysql-before.sql.gz"
printf 'invalid' > "$keep/mysql-current.sql.gz"
if bash "$script_dir/retain-backup.sh" "$root" "$keep/mysql-current.sql.gz"; then exit 1; fi
test -f "$old/mysql-before.sql.gz"
printf 'SELECT 2;\n' | gzip > "$keep/mysql-current.sql.gz"
link="$root/ui-2026-10-01T09-03-31Z-cccccccccccc-3"
ln -s "$fixture" "$link"
if bash "$script_dir/retain-backup.sh" "$root" "$keep/mysql-current.sql.gz"; then exit 1; fi
test -f "$old/mysql-before.sql.gz"
rm -- "$link"
bash "$script_dir/retain-backup.sh" "$root" "$keep/mysql-current.sql.gz"
test ! -e "$old"
test -f "$keep/mysql-current.sql.gz"
test -d "$root/legacy-unknown"
bash "$script_dir/retain-backup.sh" "$root" "$keep/mysql-current.sql.gz"
printf 'Backup retention behavior tests passed.\n'
