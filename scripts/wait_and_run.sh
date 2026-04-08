#!/bin/bash
echo "Waiting for import_desktop_data.ts to finish..."
while pgrep -f "import_desktop_data.ts" > /dev/null; do
  sleep 10
done
echo "import_desktop_data.ts finished! Starting import_deep_history.ts..."
npx tsx scripts/import_deep_history.ts > /tmp/import_deep.log 2>&1
echo "Deep history import completed."
