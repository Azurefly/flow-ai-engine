#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(sudo -n docker inspect --format '{{.State.Running}}' flow-ai-engine-app-1)" == true ]] || {
  printf 'Current application is not running; refusing image cleanup.\n' >&2
  exit 1
}
protected="$(sudo -n docker ps -aq | xargs -r sudo -n docker inspect --format '{{.Image}}' | sort -u)"
images="$(sudo -n docker images --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}' --filter reference='flow-ai-engine:*')"
removed=0
preserved=0
while read -r ref id; do
  [[ -n "$ref" ]] || continue
  [[ "$ref" == flow-ai-engine:* && "$id" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
  case "
$protected
" in *"
$id
"*) preserved=$((preserved+1)); continue ;; esac
  actual="$(sudo -n docker image inspect --format '{{.Id}}' "$ref")"
  [[ "$actual" == "$id" ]] || exit 1
  # No force: a concurrent container reference makes Docker refuse deletion.
  sudo -n docker image rm "$ref" >/dev/null
  removed=$((removed+1))
done <<< "$images"
# Older builds can lose every tag. Only the app's Compose labels identify them.
dangling="$(sudo -n docker images --no-trunc --quiet --filter dangling=true --filter label=com.docker.compose.project=flow-ai-engine --filter label=com.docker.compose.service=app | sort -u)"
while read -r id; do
  [[ -n "$id" ]] || continue
  [[ "$id" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
  case "
$protected
" in *"
$id
"*) preserved=$((preserved+1)); continue ;; esac
  sudo -n docker image rm "$id" >/dev/null
  removed=$((removed+1))
done <<< "$dangling"
printf 'Project image retention verified: removed=%s referenced=%s\n' "$removed" "$preserved"
