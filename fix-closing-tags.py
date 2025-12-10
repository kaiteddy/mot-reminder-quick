#!/usr/bin/env python3
import re
import sys

files = [
    "client/src/pages/Import.tsx",
    "client/src/pages/LogsAndMessages.tsx",
    "client/src/pages/PhoneCleanup.tsx",
    "client/src/pages/TestWhatsApp.tsx",
    "client/src/pages/DiagnoseMOT.tsx",
]

for filepath in files:
    print(f"Processing {filepath}...")
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Find the last occurrence of </div> before );
    # Replace it with </DashboardLayout>
    lines = content.split('\n')
    
    # Find the line with );
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() == ');':
            # Found the closing paren, now find the </div> before it
            for j in range(i - 1, -1, -1):
                if '</div>' in lines[j] and lines[j].strip() == '</div>':
                    # This is the outer closing div
                    lines[j] = lines[j].replace('</div>', '</DashboardLayout>')
                    print(f"  Fixed line {j+1}: {lines[j]}")
                    break
            break
    
    # Write back
    with open(filepath, 'w') as f:
        f.write('\n'.join(lines))
    
    print(f"  Done!")

print("\nAll files fixed!")
