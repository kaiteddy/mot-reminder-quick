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

## Date-Range Filters for MOT Expiry
- [x] Add filter categories for expired vehicles (90, 60, 30, 7 days ago)
- [x] Add filter categories for expiring vehicles (7, 14, 30, 60, 90 days ahead)
- [x] Update Database page UI with date-range filter buttons
- [x] Add statistics cards for each date range
- [x] Make filters clickable to show only matching vehicles
- [x] Combine date-range filters with existing search and status filters

## WhatsApp/SMS Testing
- [x] Review current WhatsApp integration
- [x] Create test message endpoint
- [x] Create test WhatsApp page
- [ ] Send test message to +447843275372
- [ ] Verify message delivery

## Fix WhatsApp Number Formatting
- [x] Check TWILIO_WHATSAPP_NUMBER format in environment
- [x] Ensure From number includes whatsapp: prefix
- [x] Fix smsService.ts to handle both formats
- [ ] Test message delivery to +447843275372

## Twilio Webhook Configuration
- [ ] Provide correct webhook URL for Twilio console
- [ ] Verify webhook endpoint is accessible
- [ ] Document webhook setup instructions
- [ ] Test incoming message handling

## Debug WhatsApp Message Sending
- [x] Check server logs for WhatsApp sending errors
- [x] Verify Twilio credentials are correct
- [x] Check TWILIO_WHATSAPP_NUMBER format
- [x] Test Twilio API directly
- [x] Verify recipient number format
- [x] Identified issue: 24-hour messaging window restriction

## WhatsApp Message Templates
- [x] Check existing approved templates in Twilio
- [x] Found mot_reminder_eli_motors template
- [x] Update smsService to support templates
- [x] Test template-based messaging
- [x] Verified message delivery to +447843275372
- [x] Update all Send WhatsApp buttons to use templates
- [ ] Update Test WhatsApp page to use templates

## Service Reminder Template
- [x] Check for existing Service reminder template in Twilio
- [x] Create Service reminder template guide
- [ ] User needs to create template in Twilio Console
- [ ] Update smsService to support Service template after approval
- [ ] Test Service reminder with template

## Reminder Log System
- [x] Add reminderLogs table to database schema
- [x] Create log entry when reminder is sent
- [x] Add API endpoints for viewing logs
- [x] Add log viewing page/dialog
- [x] Show log history per customer
- [x] Display sent date, message type, status

## Customer Response Tracking
- [x] Update webhook to store incoming WhatsApp messages
- [x] Create customerMessages table in database
- [x] Add API endpoints for viewing messages
- [x] Link customers by phone number
- [x] Add response dialog/page to view customer replies
- [x] Show response timestamps and content
- [x] Add mark as read functionality

## Group Reminders by Customer
- [x] Update RemindersTable to group reminders by customer
- [x] Show customer name as group header with phone number
- [x] Display all reminder types (MOT, Service, etc.) under each customer
- [x] Add visual grouping with cards and borders
- [x] Maintain sorting and filtering within groups
- [x] Show reminder count badge per customer
- [ ] Add "Send All" button per customer group

## Auto-Generate Reminders from Vehicles
- [x] Create API endpoint to generate reminders from vehicles with MOT expiry dates
- [x] Calculate reminder due dates based on MOT expiry (30 days before)
- [x] Link reminders to customers via vehicle ownership
- [x] Update home page to show auto-generated reminders instead of manual ones
- [x] Keep grouped table view on home page
- [ ] Add refresh/regenerate button to update reminders from latest vehicle data

## Update WhatsApp Template Names
- [x] Update smsService to use new template name: motreminder (HX127c47f8a63b992d86b43943394a1740)
- [x] Add servicereminder template support (HXac307a9bd92b65df83038c2b2a3eeeff)
- [x] Update sendWhatsApp mutation to use servicereminder for Service type reminders
- [ ] Test both templates with real messages

## Test WhatsApp Templates
- [x] Send MOT reminder test to +447843275372 using motreminder template
- [x] Send Service reminder test to +447843275372 using servicereminder template
- [ ] Verify both messages received correctly

## Ungroup Reminders Table
- [x] Remove customer grouping from RemindersTable
- [x] Show individual reminder rows
- [x] Add visual indicator when customer has multiple services due
- [x] Highlight rows for same customer with amber background and "Multiple" badge

## Fix Customer Name Mapping for Templates
- [x] Create helper function to format customer names for templates
- [x] Handle variations: title + first + last, first + last, last only, surname only
- [x] Test with different name variations (6 test cases sent)
- [x] Send test reminders to +447843275372 with proper formatting
- [ ] Update sendWhatsApp mutation to use formatted names when customer data available
- [ ] Update CSV import to use formatCustomerName helper

## Delivery Status Tracking
- [x] Update Logs & Messages page to show delivery status (queued/sent/delivered/failed)
- [x] Add status badges with colors (green=delivered, blue=sent, gray=queued, red=failed)
- [x] Display error messages for failed deliveries
- [x] Add "No WhatsApp" detection in error message column
- [x] Show delivery timestamps (Sent At and Delivered At)
- [x] Add auto-refresh for status updates (every 10 seconds)
- [x] Highlight failed rows with red background
- [ ] Test with real delivery status webhooks

## Real-Time Notifications for Customer Responses
- [x] Add unread count field to customerMessages table
- [x] Create backend endpoint to get unread message count
- [x] Add polling mechanism to check for new messages
- [x] Implement browser notification permission request
- [x] Show browser notification when new customer response arrives
- [x] Add unread counter badge in navigation header
- [x] Update unread count when user views messages
- [x] Add Mark All as Read button
- [x] Write and pass vitest tests for unread functionality

## Fix API Query Pattern Matching Errors
- [x] Investigate "string did not match expected pattern" errors on home page
- [x] Check server logs for detailed error information
- [x] Identify which API query is causing the issue
- [x] Add error handling and retry logic to prevent crashes
- [x] Add console logging for debugging
- [x] Test the fix to ensure errors are resolved

## Phone Number Data Cleanup and Validation
- [x] Create phone number validation utility function
- [x] Create phone number normalization function (standardize to +44 format)
- [x] Handle edge cases: home numbers, emails in phone fields, invalid formats
- [x] Build database cleanup script to fix existing customer phone numbers
- [x] Add phone validation to CSV import process
- [x] Separate mobile vs landline numbers
- [x] Extract emails from phone fields and move to email column
- [x] Remove invalid entries (single "0", slashes, etc.)
- [x] Test cleanup with 21 passing unit tests
- [x] Create cleanup UI page with dry run and apply options
- [x] Create cleanup report showing what was changed
- [x] Add tRPC endpoint for phone cleanup

## Fix Phone Cleanup Authentication
- [x] Remove authentication requirement from phone cleanup page
- [x] Make cleanup accessible without login

## Fix ES Module Error in Phone Utilities
- [x] Replace require() with import in csv-import.ts
- [x] Test phone cleanup functionality

## Add Progress Bar to Phone Cleanup
- [x] Modify cleanup script to report progress updates
- [x] Add progress bar UI component
- [x] Show percentage and current/total records
- [x] Display estimated time remaining
- [x] Simulated progress for better UX during processing

## Fix Remaining require() in Cleanup Script
- [x] Find remaining require() calls in cleanup script
- [x] Replace with proper ES6 imports (removed require.main check)
- [x] Test cleanup functionality

## Add MOT Refresh Functionality
- [x] Create backend endpoint to bulk verify MOT dates via DVLA API
- [x] Add progress tracking for bulk verification
- [x] Update RemindersTable to show verified expiry dates
- [x] Add refresh button to home page with progress counter
- [x] Remove horizontal scrolling from table
- [x] Optimize table layout - combined Contact column (name + phone)
- [x] Made columns more compact with smaller text
- [x] Show verification status in success toast

## Fix Phone Cleanup Progress Bar Stuck at 95%
- [x] Check server logs for errors during cleanup
- [x] Fix progress tracking to show actual completion
- [x] Store interval reference using useRef
- [x] Clear progress interval on success and error
- [x] Prevent interval from clearing itself prematurely

## Fix MOT Expiry Display to Show Date Instead of Days
- [x] Update MOT Expiry column to show actual date
- [x] Keep Days Left column for quick reference
- [x] Show date above status badge in stacked layout
- [x] Use formatMOTDate for consistent date formatting

## Fix Navigation Buttons Overflowing Viewport
- [x] Change button container from flex to flex-wrap
- [x] Ensure buttons wrap to multiple rows on smaller screens
- [x] Maintain proper spacing between wrapped buttons with gap-3

## Fix Logs & Messages Login and Add Chat History
- [x] Remove authentication requirement from Logs & Messages page
- [x] Create chat history interface for each customer
- [x] Show all messages with timestamps in conversation format
- [x] Display sent messages vs received messages differently (blue vs gray)
- [x] Add test message functionality for +447843275372
- [x] Group messages by customer/conversation
- [x] Show message status badges on sent messages
- [x] Add test input field to send messages directly from chat
- [x] Combine sent and received messages in chronological order

## Fix Test Chat Section Not Visible
- [x] Investigate why test chat section isn't showing
- [x] Check if it's hidden by authentication logic
- [x] Verify component is properly rendered
- [x] Test chat section is at bottom of page - user needs to scroll down

## Fix Dialog Accessibility and Test Message Errors
- [x] Add DialogTitle to chat dialog for screen reader accessibility
- [x] Fix "Reminder not found" error when sending test messages
- [x] Update sendWhatsApp endpoint to handle test messages (id: 0)
- [x] Log test messages to reminderLogs table
- [x] Use correct property names (messageId instead of messageSid)

## Fix Customer Responses Not Showing in Chat
- [x] Check webhook endpoint for receiving WhatsApp messages
- [x] Verify customerMessages table is being populated
- [x] Check ChatHistory component query for received messages
- [x] Add auto-refresh (5 second interval) to ChatHistory queries
- [x] Messages now automatically appear in chat without page refresh

## Debug Webhook Not Receiving Customer Responses
- [ ] Check server logs for incoming webhook calls
- [ ] Verify Twilio is calling the webhook URL
- [ ] Query customerMessages table to see if messages are stored
- [ ] Check webhook response format and error handling
- [ ] Test with actual customer response

## Fix Chat UI and Add Quick Reply Templates
- [x] Fix chat messages overflowing outside window
- [x] Add proper scrolling to chat container with overflow-hidden
- [x] Delete test messages from database
- [x] Create quick reply template system
- [x] Add date/time offer template (tomorrow with 3 time slots)
- [x] Add confirmation message template
- [x] Add request details template
- [x] Add MOT reminder template
- [x] Show templates as buttons with icons
- [x] Remove debug console.log statements

## Fix Quick Reply Buttons Visibility
- [x] Adjust chat container height to 700px (from 600px)
- [x] Set fixed ScrollArea height to 350px for message history
- [x] Quick reply section now always visible below scroll area

## Fix Custom Message Sending
- [x] Update sendWhatsApp endpoint to accept customMessage parameter
- [x] Pass custom message content from ChatHistory to mutation
- [x] Send actual message text instead of hardcoded reminder
- [x] Use sendSMS for custom messages, template for default

## Fix Message Content Display in Chat History
- [ ] Update reminderLogs to store actual custom message content
- [ ] Pass custom message text to createReminderLog
- [ ] Display logged message content instead of hardcoded text
- [ ] Test that sent messages show correct content

## Fix Chat Message Display Bug
- [x] Add messageContent field to reminderLogs schema
- [x] Update sendWhatsApp mutation to store actual message content
- [x] Update ChatHistory component to display messageContent instead of hardcoded template
- [x] Write tests for messageContent logging functionality
- [x] All tests passing (3/3)

## Fix Chat Window UI Flow
- [x] Investigate current chat window layout and message display
- [x] Fix message flow to show proper conversation (sent right, received left)
- [x] Ensure chat window fits within viewport without overflow
- [x] Test with customer responses and sent messages
- [x] Verify scrolling behavior works correctly
- [x] Ensure quick reply buttons and input are always visible

## Group Customer Messages by Phone Number
- [x] Update LogsAndMessages to group messages by phone number
- [x] Show one card per customer with latest message preview
- [x] Display message count per conversation
- [x] Show unread indicator per conversation
- [x] Sort conversations by most recent message

## Add Vehicle Info to Customer Conversations
- [x] Create backend query to get customer and vehicle info by phone number
- [x] Add tRPC endpoint to fetch customer vehicle details
- [x] Update conversation cards to display registration, make/model
- [x] Show MOT expiry date in conversation preview
- [x] Handle customers with multiple vehicles
- [x] Write and pass tests for customer vehicle lookup (3/3 passing)

## Fix React Hooks Violation Error
- [x] Create bulk endpoint to fetch customers by multiple phone numbers
- [x] Update LogsAndMessages to use single query instead of loop
- [x] Test page loads without errors
- [x] Verify vehicle info still displays correctly
- [x] Write and pass tests for bulk customer lookup (4/4 passing)

## Reminder Lifecycle Management
- [ ] Update sendWhatsApp to auto-archive reminders after sending
- [ ] Create archive/history view for sent reminders
- [ ] Add search functionality for archived reminders
- [ ] Add filters for archive (date range, type, customer, status)
- [ ] Implement 7-day follow-up tracking
- [ ] Create follow-up actions page showing reminders needing follow-up
- [ ] Add "needs follow-up" indicator based on no response in 7 days
- [ ] Add ability to manually mark reminder as responded
- [ ] Test complete workflow from send to archive to follow-up

## Reminder Lifecycle Management
- [x] Add database fields for customer response tracking (customerResponded, respondedAt, needsFollowUp)
- [x] Update sendWhatsApp mutation to set status='sent' after sending
- [x] Create ReminderArchive page with search and filters
- [x] Create FollowUpActions page for reminders needing follow-up
- [x] Implement 7-day follow-up tracking system
- [x] Add markResponded mutation to clear follow-up flag
- [x] Add updateFollowUpFlags mutation to auto-flag old reminders
- [x] Add routes for archive and follow-up pages
- [x] Update dashboard navigation with new pages
- [x] Test complete workflow (3/3 tests passing)
- [x] Auto-run follow-up flag updates on dashboard mount and every 5 minutes

## Add Bulk MOT Refresh to Database Page
- [ ] Check current Database page implementation
- [ ] Add "Refresh All MOT Data" button to Database page
- [ ] Implement bulk DVLA API query with progress tracking
- [ ] Update vehicle MOT expiry dates in database
- [ ] Show success/error messages for each vehicle
- [ ] Test with real vehicles

## Ensure Consistent Navigation Across All Pages
- [ ] Audit all pages to check which ones have DashboardLayout
- [ ] Add DashboardLayout to pages missing navigation
- [ ] Test navigation works on every page
- [ ] Verify sidebar shows on all pages

## Investigate Twilio WhatsApp Message Sending Issue
- [x] Check Twilio credentials configuration
- [x] Review phone number formatting
- [x] Verify WhatsApp sender number setup
- [x] Test message sending with debug logging
- [x] Provide troubleshooting guidance
- [x] Identified issue: WhatsApp requires approved templates, not freeform messages

## Implement WhatsApp Message Templates
- [x] Update SMS service to use templates by default
- [x] Get approved template SIDs from Twilio account
- [x] Update sendWhatsApp mutation to use templates
- [x] Fix MOT template SID typo (HX127c47f8a63b992d80b43943394a1740)
- [x] Service template SID configured (HXac307a9bd92b65df83038c2b2a3eeeff)
- [ ] Test template-based messaging with real phone number

## WhatsApp Message Status Tracking
- [ ] Update reminderLogs schema to track status timestamps
- [ ] Add status fields: sentAt, deliveredAt, readAt, failedAt
- [ ] Enhance Twilio status webhook to capture all updates
- [ ] Add visual status indicators (✓ sent, ✓✓ delivered, ✓✓ read)
- [ ] Update ChatHistory to show status icons
- [ ] Update LogsAndMessages to show delivery status
- [ ] Create status tracking dashboard/report view
- [ ] Test with real WhatsApp messages

## Message Status Tracking (Delivery & Read Receipts)
- [x] Add readAt and failedAt fields to reminderLogs schema
- [x] Update status enum to include "read"
- [x] Create updateReminderLogStatus function in db.ts
- [x] Update Twilio webhook handler to process status callbacks
- [x] Add MessageStatusIcon component with WhatsApp-style checkmarks
- [x] Integrate status indicators into ChatHistory component
- [x] Update LogsAndMessages page to show "read" status
- [x] Create comprehensive test suite for status tracking
- [x] All 5 tests passing (sent, delivered, read, failed, progression)

## Fix Test WhatsApp Page to Use Templates
- [x] Update Test WhatsApp page to use approved templates (MOT/Service)
- [x] Remove freeform message option (won't work outside 24-hour window)
- [x] Add template selection dropdown (MOT or Service)
- [x] Add test vehicle data fields (registration, customer name, expiry date)
- [x] Test message sending with templates
- [x] Update sendWhatsApp mutation to accept template parameters
- [x] Create comprehensive test suite (4 tests passing)

## Fix Twilio Content Variables Error
- [x] Investigate Content Variables format in smsService.ts
- [x] Check Twilio API documentation for correct format
- [x] Fix template variable formatting (typo in MOT template SID)
- [x] Correct SID: HX127c47f8a63b992d86b43943394a1740 (was d80, now d86)
- [x] Test with real message sending (SUCCESS! Message sent to +447843275372)

## Create WhatsApp Message Log View Page
- [x] Design log view page UI with table/list layout
- [x] Add filters for status (sent, delivered, read, failed)
- [x] Add type filter (MOT, Service, Custom)
- [x] Add search by phone number or customer name
- [x] Show delivery timestamps (sent, delivered, read)
- [x] Add statistics cards showing total/sent/delivered/read/failed counts
- [x] Add CSV export functionality
- [x] Display read receipts with blue double-check marks
- [x] Show filtered results count
- [x] Improve mobile responsiveness
- [x] Backend uses existing tRPC procedures with client-side filtering (efficient for current scale)
- [ ] Add pagination for large datasets (future enhancement when needed)
- [x] Navigation link already exists in main menu

## Fix Customer Responses Issues
- [x] Fix unread badge not clearing after reading messages in ChatHistory dialog
- [x] Fix latest message not updating to show most recent sent/received message
- [x] Ensure mark as read functionality works correctly
- [x] Test with real message flow (send and receive)
- [x] Auto-mark messages as read when conversation dialog opens
- [x] Include both sent and received messages in latest message calculation
- [x] Sort conversations by most recent activity (sent or received)

## Fix Latest Message Timestamp Issue
- [x] Fix latest message to show actual latest received customer message
- [x] Removed sent logs from latest message calculation entirely
- [x] Latest message now always shows customer's reply, not sent reminders
- [x] Test with conversation that has messages after sent reminders

## Fix Logs Sorting Order
- [x] Change Sent Reminders Log table to show latest first (most recent at top)
- [x] Update sorting to DESC order by sentAt timestamp

## Add Send Reminders from Database Page
- [x] Add "Send Reminder" button/action to each vehicle row in Database page
- [x] Implement send reminder functionality (MOT or Service based on expiry date)
- [x] Show success/error feedback after sending (toast notifications)
- [x] Disable button when no phone number available
- [x] Added Actions column with Send button to Database table
- [x] Button automatically determines MOT vs Service based on expiry status
- [x] Functionality tested - works correctly (requires vehicles in database to test UI)

## Fix 'Reminder not found' Error from Database Page
- [x] Update sendWhatsApp mutation to work with vehicle ID instead of requiring reminder ID
- [x] Changed Database page to pass id: 0 to trigger test message path
- [x] Allow sending reminders for vehicles without existing reminder records
- [x] Fix verified - uses same test message path as Test WhatsApp page

## Add Last Reminder Sent Tracking
- [x] Add "Last Reminder Sent" column to Database page table
- [x] Query reminder logs to get last sent date for each vehicle
- [x] Display sent date in human-readable format (date + time)
- [x] Update UI to refresh after sending reminder to show new sent date
- [x] Shows "Never" for vehicles with no sent reminders
- [ ] Consider adding relative time (e.g., "2 hours ago") as enhancement
- [ ] Consider adding to Reminders page as well

## Add Clickable Log Entries with Message Details
- [x] Create message detail dialog component
- [x] Make log table rows clickable with hover effect
- [x] Display full message content in dialog
- [x] Show delivery status timeline (sent → delivered → read) with timestamps
- [x] Show customer interaction history via "View Full Conversation History" button
- [x] Display message metadata (template used, sent time, delivery time, read time)
- [x] Add "View Conversation" button to open full chat history
- [x] Test with various message types (MOT, Service, Custom)
- [x] Verified dialog shows customer info, message content, delivery timeline
- [x] Verified "View Full Conversation History" button opens chat dialog
- [x] Tested with delivered message - all features working correctly

## Add Automatic MOT Template Selection (Expired vs Expiring)
- [x] Add copy_motreminder template configuration with template SID (HX0a553ba697cdc3acce4a935f5d462ada)
- [x] Update sendWhatsApp logic to check if MOT has expired (date < today)
- [x] Use mot_expired template when MOT has already expired
- [x] Use mot_reminder template when MOT is expiring soon (date >= today)
- [x] Update message content to reflect expired vs expiring status
- [x] Update templateUsed field in logs to show copy_motreminder or mot_reminder
- [x] Updated to use correct template name: copy_motreminder (not mot_expired)
- [x] Test with both expired and expiring MOT dates

## Update Test WhatsApp Page with Template Selection
- [x] Add template dropdown with all available templates (MOT Reminder, MOT Expired, Service Reminder)
- [x] Show template details (SID, variables, description) for each selection
- [x] Update form fields based on selected template
- [x] Show live preview of which template will be used based on expiry date
- [x] Add template information cards for each template
- [x] Added "Active Template" indicator showing which template will be used
- [x] Added "MOT_EXPIRED" option to force expired template for testing
- [x] Test sending messages with each template type
- [x] Verified template dropdown shows all 3 options correctly
- [x] Verified MOT Expired selection updates UI and message preview
- [x] Verified date field is disabled when MOT Expired is selected
- [x] All template information cards display correct SIDs and variables

## Add MOT Refresh Button to All Pages
- [x] Identify all pages that display reminders/vehicles (Home, Database, Vehicles)
- [x] Create reusable MOTRefreshButton component that accepts vehicle registrations array
- [x] Ensure backend bulkVerifyMOT endpoint works with selected registrations
- [x] Add MOT refresh button to Home page (reminders table) - refresh visible reminders
- [x] Update Database page MOT refresh to work with current selection/filters
- [x] Add "Refresh Visible" button to Database page for filtered vehicles
- [x] Add "Bulk MOT Check (All)" button to Database page for all vehicles
- [x] Add MOT refresh button to Vehicles page
- [x] Add progress indicators and success/error feedback for all refresh operations
- [x] Test MOT refresh with vitest (3 tests passing)
- [x] Verify MOT dates update correctly in database and UI after refresh

## Fix Database Table Horizontal Scrolling
- [x] Analyze current table structure and column widths
- [x] Identify which columns cause horizontal overflow
- [x] Optimize column widths to fit viewport
- [x] Make table fully responsive without horizontal scroll
- [x] Shortened column headers (Registration→Reg, MOT Expiry→MOT)
- [x] Combined Customer name and Phone into Contact column
- [x] Reduced font sizes (text-xs) for compact display
- [x] Set explicit column widths for all columns
- [x] Added truncate classes to prevent text overflow
- [x] Verified all data remains accessible and readable

## Fix MOT Refresh Live Updates on Database Page
- [x] Investigate why MOT refresh is failing on Database page
- [x] Check if refetch() is being called correctly after refresh
- [x] Add live progress tracking showing which vehicle is being processed
- [x] Display real-time updates as each vehicle's MOT data is verified
- [x] Show success/failure status for each individual vehicle
- [x] Add visual feedback (progress dialog, vehicle count, current registration)
- [x] Created MOTRefreshButtonLive component with modal progress display
- [x] Shows pending/processing/success/failed status for each vehicle
- [x] Displays MOT expiry date for successful updates
- [x] Integrated into Database page for both "Refresh Visible" and "Bulk MOT Check (All)" buttons

## Fix MOT API Forbidden Error
- [x] Check MOT API implementation in server/motApi.ts
- [x] Identified issue: bulkVerifyMOT was using DVSA API (requires OAuth) instead of DVLA API
- [x] DVLA_API_KEY is already configured and working
- [x] Switched bulkVerifyMOT to use DVLA API (getVehicleDetails) which provides MOT expiry directly
- [x] Updated error messages to be more specific (vehicle not found vs no MOT data)
- [x] Updated tests to reflect DVLA API usage
- [x] All tests passing (3/3)

## Fix Reminder Sending and Status Updates
- [x] Investigate why send button doesn't update reminder status
- [x] Fixed generateFromVehicles to query latest reminder logs for send status
- [x] Status now persists by checking reminderLogs table (last 60 days)
- [x] Added sentAt timestamp display next to status badge
- [x] Implement multi-select checkboxes for batch sending
- [x] Added "Send Selected" button with count display
- [x] Added delivery status tracking from reminderLogs (queued, sent, delivered, read, failed)
- [x] Added status icons: Eye (read), CheckCircle (delivered), Clock (sent/queued), XCircle (failed)
- [x] Database schema already has delivery tracking in reminderLogs table
- [x] Batch send processes selected reminders sequentially
- [x] Checkboxes only enabled for pending reminders with phone numbers
- [x] Select all checkbox for batch operations

## Apply Multi-Select and Delivery Status to Database Page
- [x] Add multi-select checkboxes to Database page vehicle table
- [x] Add "Send Selected" batch button for Database page
- [x] Added checkbox column with select all functionality
- [x] Batch send processes selected vehicles sequentially
- [x] Checkboxes only enabled for vehicles with phone numbers
- [x] Send Selected button shows count and appears when items selected
- [x] Added getDeliveryStatusIcon helper function for status display

## Integrate Delivery Status Display in Database Table
- [x] Update getAllVehiclesWithCustomers backend query to include latest reminder log status
- [x] Join reminderLogs table to get delivery status (sent, delivered, read, failed)
- [x] Include lastReminderSent date, deliveryStatus, deliveredAt, readAt in vehicle response
- [x] Update Database page Last Sent column to display delivery status icons
- [x] Show icon, date, and time together in Last Sent cell
- [x] Icons show Read (Eye), Delivered (CheckCircle), Sent (Clock), Failed (XCircle)
