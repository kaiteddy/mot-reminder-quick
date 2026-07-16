#!/bin/bash
# One-command: pull the latest GA4 work write-ups into the web app.
# RUN THIS RIGHT AFTER doing a GA4 CSV export (File -> Export in GA4).
# Safe to run as often as you like — it only fills in / refreshes descriptions.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"
# DB credentials (kept outside the repo)
[ -f "$HOME/.ga4-sync.env" ] && set -a && . "$HOME/.ga4-sync.env" && set +a
# Where GA4's CSV export lands (the VM's shared Data Exports folder). Override with GA4_EXPORTS.
export GA4_EXPORTS="${GA4_EXPORTS:-/Volumes/[C] Win11Manual.hidden/GA4 User Data/Data Exports}"
echo "Reading export from: $GA4_EXPORTS"
node scripts/sync-descriptions.mjs --go
