#!/bin/bash
# GA4 -> Web sync wrapper for unattended (launchd) runs.
#
#   ./scripts/ga4-sync.sh          # DRY RUN (reports, writes nothing)
#   ./scripts/ga4-sync.sh --go     # apply (insert-only customers/vehicles, upsert docs/line items)
#
# Logs each run to ~/Library/Logs/ga4-sync/YYYY-MM-DD-HHMM.log and keeps a `latest.log`.
# Safe by design: see scripts/sync-ga4.ts — matches strictly on GA4 _ID, never deletes,
# never overwrites existing customer/vehicle rows.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="$HOME/Library/Logs/ga4-sync"
mkdir -p "$LOGDIR"
STAMP="$(date +%Y-%m-%d-%H%M)"
LOG="$LOGDIR/$STAMP.log"

cd "$PROJECT"
{
  echo "=== GA4 sync $STAMP  args: ${*:-<dry-run>} ==="
  npx tsx scripts/sync-ga4.ts "$@"
  echo "=== done $(date +%H:%M:%S) ==="
} 2>&1 | tee "$LOG"
cp "$LOG" "$LOGDIR/latest.log"
