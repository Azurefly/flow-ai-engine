#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

# Only public, fingerprinted build files. No source, maps, HTML or runtime data.
[[ $# == 2 ]] || { echo 'Usage: retain-static-assets.sh <container-id> <runtime-assets-directory>' >&2; exit 1; }
container="$1"
cache="$2"
[[ "$container" =~ ^[a-f0-9]{12,64}$ && "$cache" == /* && "${cache##*/}" == runtime-assets && ! -L "$cache" ]] || exit 1
install -d -m 0755 -- "$cache"
[[ "$(realpath -e -- "$cache")" == "$cache" ]] || exit 1
stage="$(mktemp -d "$cache/.staging-XXXXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
docker cp "$container:/app/dist/public/assets/." "$stage/"
pattern='^[-A-Za-z0-9_]+-[A-Za-z0-9_-]{8}\.(js|css|woff2?|ttf|svg|png|jpe?g|webp|gif|ico)$'
while IFS= read -r -d '' file; do
  name="${file##*/}"
  [[ -f "$file" && ! -L "$file" && "$name" =~ $pattern ]] || { echo 'Unsupported public asset; refusing retention' >&2; exit 1; }
  [[ ! -L "$cache/$name" ]] || exit 1
  if [[ -e "$cache/$name" ]]; then
    cmp -s -- "$file" "$cache/$name" || { echo 'Fingerprint collision' >&2; exit 1; }
  else
    install -m 0644 -- "$file" "$cache/$name"
  fi
  touch -- "$cache/$name"
done < <(find "$stage" -mindepth 1 -maxdepth 1 -print0)

# Bound retention to 30 days and 256 MiB. Oldest unreferenced builds leave first.
total=0
while read -r stamp name; do
  [[ "$name" =~ $pattern && -f "$cache/$name" && ! -L "$cache/$name" ]] || exit 1
  size="$(stat -c %s -- "$cache/$name")"
  if [[ "$(find "$cache/$name" -mtime +30 -print)" != '' ]]; then
    rm -- "$cache/$name"
  else
    total=$((total+size))
  fi
done < <(find "$cache" -maxdepth 1 -type f -printf '%T@ %f\n' | sort -n)
while read -r stamp name; do
  (( total > 268435456 )) || break
  [[ "$name" =~ $pattern && -f "$cache/$name" && ! -L "$cache/$name" ]] || exit 1
  size="$(stat -c %s -- "$cache/$name")"
  rm -- "$cache/$name"
  total=$((total-size))
done < <(find "$cache" -maxdepth 1 -type f -printf '%T@ %f\n' | sort -n)
printf 'Public asset cache verified: bytes=%s maxAgeDays=30 maxBytes=268435456\n' "$total"
