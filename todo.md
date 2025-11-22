# MOT Reminder Quick App - TODO

## Core Features

### Database & Schema
- [x] Create reminders table (type, date, registration, customer info, status)
- [x] Create vehicles table (registration, make, model, MOT expiry)
- [x] Create customers table (name, email, phone)

### Image Upload & OCR
- [x] Drag-and-drop image upload interface
- [x] Image preview before processing
- [x] OCR processing using LLM vision API
- [x] Extract reminder data from screenshot (type, date, registration, customer details)
- [x] Parse and structure extracted data

### Reminder Management
- [x] Display all reminders in list view
- [x] Filter reminders (due now, upcoming, archived)
- [ ] Edit reminder details (fix OCR errors, update registration)
- [ ] Mark reminders as sent/archived
- [ ] Delete reminders

### MOT Check Integration
- [ ] MOT history lookup by registration
- [ ] Display MOT expiry date
- [ ] Auto-populate vehicle details from DVSA API
- [ ] Update vehicle MOT status

### Reminder Sending
- [ ] Send SMS reminders
- [ ] Send email reminders
- [ ] Preview reminder message before sending
- [ ] Track sent status

### UI/UX
- [x] Clean, focused dashboard
- [x] "Reminders Due Now" section
- [x] Quick upload button
- [ ] Search and filter functionality
- [ ] Responsive design

## New Features to Add

### MOT API Integration
- [x] Add MOT API credentials to environment
- [x] Create MOT API service helper
- [x] Add vehicle lookup by registration
- [x] Auto-populate vehicle details from DVSA API
- [x] Display MOT expiry date

### Edit Functionality
- [x] Create edit reminder dialog/modal
- [x] Allow editing all reminder fields
- [x] Update registration and re-fetch from API
- [x] Mark reminder as sent/archived
- [x] Delete reminder

### SMS Sending
- [x] Add Twilio credentials to environment
- [x] Create SMS service helper (WhatsApp)
- [x] Add send WhatsApp button to reminders
- [x] Generate reminder messages
- [x] Track sent status and timestamp

### Webhook Integration
- [x] Create webhook endpoint for Twilio responses
- [x] Handle incoming WhatsApp messages
- [x] Log message responses
- [x] Update reminder status based on responses

## MOT Check Page
- [x] Create MOT check page with registration input
- [x] Add navigation link to MOT check page
- [x] Display vehicle details (make, model, colour, fuel type)
- [x] Show MOT expiry date prominently
- [x] Display complete MOT test history
- [x] Show test results (pass/fail) with dates
- [x] Display advisories and defects for each test
- [x] Show mileage history from MOT tests
- [x] Add tax status and expiry from DVLA API

## MOT Expiry Display Improvements
- [x] Add MOT expiry date display on MOT check page
- [x] Add countdown days until expiry on MOT check page
- [x] Show MOT expiry status badges (expired, due soon, valid)
- [x] Update reminders list to show MOT expiry date
- [x] Add days until expiry countdown in reminders list
- [x] Replicate GitHub GarageManager MOT display design
- [x] Highlight expired/critical MOT dates in red
- [x] Show upcoming expiry dates in orange/yellow

## MOT Expiry Display Fix
- [x] Investigate why MOT expiry not showing on MOT check page
- [x] Ensure motExpiryDate is being returned from API
- [x] Add debug logging to check API response
- [x] Fix display to show expiry prominently
- [x] Add TEST123 mock registration for demo purposes

## Process Screenshot and Run MOT Checks
- [x] Upload screenshot to app via API
- [x] Extract all reminders from screenshot using OCR (25 reminders extracted)
- [x] Run MOT checks on all extracted registrations (DVLA working, MOT API needs credentials refresh)
- [x] Display MOT history and expiry for each vehicle

## DVSA MOT API Research
- [ ] Research DVSA MOT History API documentation
- [ ] Understand authentication and OAuth 2.0 requirements
- [ ] Investigate Forbidden error causes
- [ ] Find solutions to restore API access
- [ ] Document proper API usage and troubleshooting steps

## Complete API Response Display
- [x] Update MOT check page to show all DVLA fields
- [x] Display all MOT test history fields
- [x] Format defects and advisories properly
- [x] Show complete vehicle technical data
- [x] Add responsive grid layout for data display

## MOT Expiry Display Issue
- [x] Test MOT lookup with registration LN64XFG
- [x] Verify MOT expiry date is showing on results
- [x] Fix any issues preventing expiry display (DVLA API provides motExpiryDate!)
- [x] Ensure expiry works for real registrations (not just TEST123)

## Bulk Screenshot Processing
- [x] Update processImage to return array of structured reminders
- [x] Create bulkSaveReminders procedure
- [x] Enrich each reminder with DVLA API data (MOT expiry, vehicle details)
- [x] Save all reminders, customers, and vehicles to database
- [x] Add motExpiryDate field to reminders schema
- [x] Display MOT expiry date in reminder cards
- [x] Automatic DVLA enrichment during screenshot processing

## Table View for Reminders
- [x] Convert card-based reminders display to table format
- [x] Show all reminder details in table columns (Type, Due Date, Registration, Customer, Phone, Email, Vehicle, MOT Expiry, Days Left, Status)
- [x] Add action buttons column (Edit, Send WhatsApp, Delete)
- [x] Make table responsive and sortable
- [x] Highlight urgent reminders in table

## Table Sorting and Filtering
- [x] Add sortable column headers (Type, Due Date, Registration, Customer, MOT Expiry, Days Left, Status)
- [x] Implement sort state management (column, direction)
- [x] Add sort indicators (up/down arrows) to column headers
- [x] Create filter dropdowns for Type (MOT, Service, All)
- [x] Create filter dropdowns for Status (pending, sent, archived, All)
- [x] Combine filters with sorting
- [x] Persist sort/filter state in component

## CSV Import from Garage Assistant 4
- [x] Analyze CSV file structures (Customers, Vehicles, Reminders, Reminder_Templates)
- [x] Create CSV upload interface
- [x] Implement CSV parsing for Customers.csv
- [x] Implement CSV parsing for Vehicles.csv
- [x] Implement CSV parsing for Reminders.csv
- [x] Map Garage Assistant 4 fields to MOT Reminder Quick schema
- [x] Handle duplicate detection and merging
- [x] Add import progress indicator
- [x] Create import summary report
- [ ] Test with real Garage Assistant 4 data

## Customer and Vehicle Management Views
- [x] Create customers list page with table view
- [x] Add customer search and filtering
- [ ] Create customer detail page showing vehicles and reminders
- [x] Create vehicles list page with table view
- [x] Add vehicle search and filtering
- [ ] Create vehicle detail page showing MOT history and reminders
- [x] Add navigation links to customers and vehicles pages
- [x] Add database queries for customers and vehicles

## Review and Update Import Logic from garage-management-system
- [x] Clone garage-management-system repository
- [x] Analyze existing CSV import scripts
- [x] Review data mapping and linking logic
- [x] Compare with current MOT Reminder Quick implementation
- [x] Update import router with smart merge logic for customers
- [x] Update import router with smart merge and linking for vehicles
- [x] Add connection preservation tracking
- [ ] Add performance indexes for faster imports
- [ ] Test import with actual GA4 CSV files

## Improve MOT Checker
- [x] Review current MOT checker implementation
- [x] Add better error handling for DVLA/MOT API
- [x] Add UK registration validation
- [x] Implement graceful degradation for API failures
- [ ] Improve UI/UX for MOT results display
- [ ] Add vehicle history display

## Fix Import Error
- [x] Debug base64 pattern validation error on /import page
- [x] Fix CSV data encoding/format issue (handle both data URL and raw base64)
- [x] Fix invalid date parsing error in vehicle import
- [ ] Test import with actual CSV files

## Database Overview Page
- [x] Create database query to fetch all vehicles with customer and MOT data
- [x] Create database overview page component
- [x] Add MOT status indicators (expired/due/valid)
- [x] Add sorting and filtering capabilities
- [x] Add search functionality
- [x] Add bulk MOT API check functionality
- [x] Add progress tracking for bulk updates
- [x] Add route and navigation link

## Investigate Vehicles with No MOT Data
- [x] Query database for vehicles without MOT expiry dates
- [x] Check registration format validity
- [x] Test DVLA API with sample registrations
- [x] Add diagnostic endpoint to check specific vehicles
- [x] Create report showing reasons for missing MOT data
- [x] Add diagnostic page with recommendations
