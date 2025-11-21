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
