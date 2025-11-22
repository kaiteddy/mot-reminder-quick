# Import Logic Analysis from garage-management-system

## Key Findings from Existing Implementation

### 1. CSV File Processing Order
The proven implementation processes files in this specific order to maintain referential integrity:
1. Customers.csv
2. Vehicles.csv
3. Documents.csv
4. LineItems.csv
5. Document_Extras.csv
6. Appointments.csv
7. Receipts.csv
8. Reminder_Templates.csv
9. Reminders.csv
10. Stock.csv

### 2. Customer Processing Logic (Smart Merge)

**Matching Strategy** (in priority order):
1. Phone number match (highest priority)
2. Email match (second priority)
3. Full name match (lowest priority)

**Smart Merge Rules**:
- First name: Update if existing is empty, shorter, or generic ("customer", "unknown")
- Last name: Update if existing is empty, shorter, or just numbers
- Phone: Update if existing is empty or new is longer (minimum 10 digits)
- Email: Update if existing is empty, contains "placeholder", or new is better
- Always prefer better quality data over existing data

**Field Mapping**:
```
CSV Field → Database Field
first_name or firstName → first_name
last_name or lastName → last_name
phone → phone
email → email
```

### 3. Vehicle Processing Logic (Smart Merge + Linking)

**Registration Normalization**:
- Always uppercase
- Remove all spaces
- Used as primary matching key

**Smart Merge Rules**:
- Make: Update if existing is empty or new is longer/more specific
- Model: Update if existing is empty or new is longer/more specific
- Year: Update if existing is null or new is more accurate (extracted from DateofReg)
- Other fields (color, VIN, engine_size, fuel_type, mot_expiry_date): Only update if existing is empty (COALESCE)

**Smart Customer Linking**:
- If vehicle has no existing customer_id or owner_id
- Try to match by customer_name or owner_name
- Match against: "first_name || ' ' || last_name" OR "last_name || ', ' || first_name"
- Set both customer_id and owner_id to matched customer

**Connection Preservation**:
- Count and preserve existing customer-vehicle relationships
- Never overwrite existing customer_id/owner_id unless empty

**Field Mapping**:
```
CSV Field → Database Field
Registration or registration or reg → registration (uppercase, no spaces)
Make or make → make
Model or model → model
DateofReg → year (extract year)
Colour or color or colour → color
VIN or vin → vin
EngineCC or engine_size → engine_size
FuelType or fuel_type → fuel_type
mot_expiry_date or mot_expiry → mot_expiry_date
customer_name or owner_name → (used for smart linking)
```

### 4. Performance Optimizations

**Indexes Created**:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_doc_number ON documents(doc_number)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_name ON customers(LOWER(first_name || ' ' || last_name))
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_registration ON vehicles(UPPER(REPLACE(registration, ' ', '')))
```

### 5. Date Parsing

**UK Date Format (DD/MM/YYYY)**:
- Validate day (1-31), month (1-12), year (1900-current+1)
- Skip invalid dates like '01/01/2000' (placeholder)
- Return null for invalid dates

### 6. Error Handling

- Continue processing on individual record errors
- Log errors but don't stop entire import
- Track counts: processed, newRecords, updatedRecords, preservedConnections, smartLinked

## Differences from Current MOT Reminder Quick Implementation

### Current Implementation Issues:
1. **No smart merge** - Simple insert/update without quality comparison
2. **No smart linking** - Vehicles not automatically linked to customers by name
3. **No connection preservation tracking** - Don't count preserved relationships
4. **Different field mapping** - Using different CSV field names
5. **No performance indexes** - Missing database indexes for faster lookups
6. **Case-sensitive matching** - Not normalizing registration/names for matching

### Recommended Updates:
1. Adopt smart merge logic for customers (prefer better quality data)
2. Implement smart vehicle-customer linking by name
3. Add connection preservation tracking
4. Update field mapping to match GA4 CSV structure exactly
5. Add performance indexes before import
6. Normalize registration numbers (uppercase, no spaces) for matching
7. Use case-insensitive name matching

## Next Steps

1. Update `server/services/csv-import.ts` to match proven logic
2. Add performance indexes to schema
3. Implement smart merge and linking
4. Update field mappings to match GA4 CSV structure
5. Test with actual GA4 CSV files
