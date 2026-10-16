#!/usr/bin/env bash
set -Eeuo pipefail
SOURCE_ROOT="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
[[ -d "$SOURCE_ROOT" ]] || { printf 'Source directory is missing\n' >&2; exit 1; }
cd "$SOURCE_ROOT"
find . \
  \( -type d \( -name .git -o -name .cache -o -name node_modules -o -name dist -o -name docs -o -name reference-analysis-temp \) -prune \) -o \
  \( -type f \( -name .env -o \( -name '.env.*' ! -name .env.example \) -o -name '*.log' \) -prune \) -o \
  -type f -print0 |
  LC_ALL=C sort -z | xargs -0 -r sha256sum | sha256sum | awk '{print $1}'
