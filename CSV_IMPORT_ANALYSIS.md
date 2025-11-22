# Garage Assistant 4 CSV Import Analysis

## Data Overview

- **Customers**: 7,211 records
- **Vehicles**: 10,689 records
- **Reminders**: 11,760 records
- **Reminder Templates**: 7 records

## Field Mapping

### Customers.csv → customers table

| GA4 Field | MOT Quick Field | Notes |
|-----------|----------------|-------|
| nameForename + nameSurname | name | Combine first and last name |
| contactEmail | email | Direct mapping |
| contactMobile or contactTelephone | phone | Prefer mobile, fallback to telephone |
| _ID | externalId | Store original GA4 ID for reference |

**Key GA4 Fields:**
- `nameTitle`, `nameForename`, `nameSurname`, `nameCompany`
- `contactEmail`, `contactMobile`, `contactTelephone`
- `addressHouseNo`, `addressRoad`, `addressTown`, `addressPostCode`, `addressCounty`
- `regularCustomer`, `remindersAllowed`

### Vehicles.csv → vehicles table (extended schema needed)

| GA4 Field | MOT Quick Field | Notes |
|-----------|----------------|-------|
| Registration | registration | Direct mapping |
| Make | make | Direct mapping |
| Model | model | Direct mapping |
| Colour | colour | New field needed |
| FuelType | fuelType | New field needed |
| DateofReg | dateOfRegistration | New field needed |
| VIN | vin | New field needed |
| _ID | externalId | Store original GA4 ID |
| _ID_Customer | customerId | Link to customer |

**Key GA4 Fields:**
- `Registration`, `Make`, `Model`, `Colour`, `FuelType`
- `VIN`, `DateofReg`, `EngineCC`, `TypeofVehicle`
- `Notes`, `Notes_Reminders`
- `_ID_Customer` (links to customer)

### Reminders.csv → reminders table

| GA4 Field | MOT Quick Field | Notes |
|-----------|----------------|-------|
| DueDate | dueDate | Direct mapping |
| _ID_Template | type | Map template ID to MOT/Service/Other |
| _ID_Vehicle | vehicleId | Link to vehicle (then to customer) |
| actioned_Print or actioned_Email or actioned_SMS | status | If any actioned = "sent", else "pending" |
| actionedDate_* | sentAt | Use whichever actioned date exists |

**Key GA4 Fields:**
- `DueDate` - When reminder is due
- `_ID_Template` - Links to Reminder_Templates (MOT, Service, Cambelt, Other)
- `_ID_Vehicle` - Links to vehicle
- `actioned_Email`, `actioned_Print`, `actioned_SMS` - Whether reminder was sent
- `actionedDate_Email`, `actionedDate_Print`, `actionedDate_SMS` - When sent
- `method_Email`, `method_Print`, `method_SMS` - Preferred method

### Reminder_Templates.csv → reminder types

| Template ID | Type |
|-------------|------|
| 0526AF6DAB24764B942E0E0F1000EED0 | MOT |
| 30DE5E6B652872449B324DCFE37B1A0B | Service |
| D00D925A2B89234D9D074F10FF881E92 | Cambelt |
| 8D9AAB67211C7E4BBE895A8FF5468AAE | Other |

## Import Strategy

1. **Import Customers first**
   - Create customers with GA4 _ID stored as externalId
   - Map to new auto-increment IDs

2. **Import Vehicles second**
   - Link to customers using _ID_Customer → externalId mapping
   - Enrich with DVLA API data (MOT expiry, tax status)
   - Store GA4 _ID as externalId

3. **Import Reminders last**
   - Map _ID_Template to reminder type (MOT/Service)
   - Link to vehicles using _ID_Vehicle → externalId mapping
   - Derive customer info from vehicle relationship
   - Set status based on actioned flags

## Schema Extensions Needed

Current schema needs these additions:

```sql
-- Add to customers table
ALTER TABLE customers ADD COLUMN externalId VARCHAR(255);
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN postcode VARCHAR(20);
ALTER TABLE customers ADD COLUMN notes TEXT;

-- Add to vehicles table  
ALTER TABLE vehicles ADD COLUMN externalId VARCHAR(255);
ALTER TABLE vehicles ADD COLUMN colour VARCHAR(50);
ALTER TABLE vehicles ADD COLUMN fuelType VARCHAR(50);
ALTER TABLE vehicles ADD COLUMN dateOfRegistration DATE;
ALTER TABLE vehicles ADD COLUMN vin VARCHAR(50);
ALTER TABLE vehicles ADD COLUMN engineCC INT;
ALTER TABLE vehicles ADD COLUMN notes TEXT;

-- Add to reminders table
ALTER TABLE reminders ADD COLUMN externalId VARCHAR(255);
ALTER TABLE reminders ADD COLUMN sentMethod VARCHAR(20); -- email, print, sms
```

## Import Process

1. **CSV Upload UI** - Allow user to upload CSV files
2. **Parse & Validate** - Check CSV structure and data quality
3. **Preview** - Show sample of data to be imported
4. **Import with Progress** - Process in batches with progress bar
5. **Summary Report** - Show counts of imported records, errors, duplicates
6. **DVLA Enrichment** - Optionally enrich vehicles with DVLA API data

## Encoding Handling

CSV files are ISO-8859-1 encoded, need to handle conversion to UTF-8 during import.
