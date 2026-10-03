#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# == 2 ]] || die 'Usage: retain-backup.sh <project-backup-directory> <verified-backup-file>'
backup_root="$(realpath -e -- "$1")"
keep_file="$(realpath -e -- "$2")"
[[ -d "$backup_root" && "$backup_root" != / && "${backup_root##*/}" == backups ]] || die 'Invalid project backup directory'
[[ -f "$keep_file" && ! -L "$2" && "$keep_file" == "$backup_root/"* ]] || die 'Backup to retain must be a regular file inside the backup directory'
keep_dir="$(dirname -- "$keep_file")"
[[ "$(dirname -- "$keep_dir")" == "$backup_root" ]] || die 'Verified backup must be in one direct backup subdirectory'
managed_pattern='^ui-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z-[a-f0-9]{12}-[0-9]+$'
[[ "${keep_dir##*/}" =~ $managed_pattern ]] || die 'Retained backup is not a deployment-managed backup'
[[ "$keep_file" == *.sql.gz ]] || die 'Expected a compressed SQL backup'
gzip -t -- "$keep_file" || die 'Retained backup failed integrity verification; nothing deleted'
[[ -s "$keep_file" ]] || die 'Retained backup is empty; nothing deleted'

# Validate every target before deleting any. Never follow a backup symlink into
# an active checkout, secret directory or database volume.
stale=()
while IFS= read -r -d '' entry; do
  [[ "$entry" == "$keep_dir" ]] && continue
  [[ "${entry##*/}" =~ $managed_pattern ]] || continue
  [[ ! -L "$entry" ]] || die 'Unexpected backup symlink; nothing deleted'
  resolved="$(realpath -e -- "$entry")"
  [[ "$resolved" == "$backup_root/"* && "$resolved" != "$backup_root" && "$resolved" != "$keep_dir" ]] || die 'Deletion target escaped backup directory; nothing deleted'
  [[ -d "$entry" ]] || die 'Managed backup entry is not a directory; nothing deleted'
  [[ -z "$(find "$entry" -mindepth 1 \( ! -type f -o ! -name 'mysql-*.sql.gz' \) -print -quit)" ]] || die 'Unexpected content in managed backup; nothing deleted'
  stale+=("$entry")
done < <(find "$backup_root" -mindepth 1 -maxdepth 1 -print0)
if ((${#stale[@]})); then rm -rf -- "${stale[@]}"; fi
printf 'Backup retention verified: removed=%s retained=%s\n' "${#stale[@]}" "$keep_file"
