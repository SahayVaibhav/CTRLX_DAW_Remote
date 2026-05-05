#!/bin/zsh

set -euo pipefail

ROOT="/Users/kuhusingh/Documents/New codex project/CTRLX_Dev_Stage"
LOG_FILE="${TMPDIR:-/tmp}/ctrlx-host-launcher.log"

cd "$ROOT"

npm run build:shared >>"$LOG_FILE" 2>&1
npm run build --workspace @ctrlx/host >>"$LOG_FILE" 2>&1

nohup "$ROOT/node_modules/.bin/electron" "$ROOT/apps/host" >>"$LOG_FILE" 2>&1 &

