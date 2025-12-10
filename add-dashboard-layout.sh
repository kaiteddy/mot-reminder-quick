#!/bin/bash

# List of pages to update (excluding Home, MOTCheck which are already done, and NotFound/ComponentShowcase)
PAGES="Customers Database DiagnoseMOT Import LogsAndMessages PhoneCleanup TestWhatsApp Vehicles"

for PAGE in $PAGES; do
  FILE="client/src/pages/${PAGE}.tsx"
  
  echo "Processing $FILE..."
  
  # Check if DashboardLayout is already imported
  if grep -q "DashboardLayout" "$FILE"; then
    echo "  - Already has DashboardLayout, skipping"
    continue
  fi
  
  # Add import after other imports
  sed -i '/^import.*from.*wouter/a import DashboardLayout from "@/components/DashboardLayout";' "$FILE"
  
  # Replace opening div with DashboardLayout
  # Pattern 1: <div className="min-h-screen...">
  sed -i 's|<div className="min-h-screen[^"]*">|<DashboardLayout>|' "$FILE"
  
  # Pattern 2: Find the matching closing </div> and replace with </DashboardLayout>
  # This is tricky, so we'll do it manually for each file
  
  echo "  - Added import and opening tag"
done

echo "Done! Please manually fix closing tags for each file."
