# Creating Service Reminder WhatsApp Template

## Steps to Create Template in Twilio

1. **Go to Twilio Content Editor**
   - Visit: https://console.twilio.com/us1/develop/sms/content-editor
   - Click "Create new Content"

2. **Select Channel**
   - Choose "WhatsApp" as the channel

3. **Template Details**
   - **Template Name**: `service_reminder_eli_motors`
   - **Category**: UTILITY
   - **Language**: English (UK) - `en_GB`

4. **Template Content**

```
🔧 *Eli Motors Ltd* - Service Reminder

Hi {{1}},

Your vehicle {{2}} is due for service on {{3}} ({{4}} days).

📅 Book your service today
📞 Call: 0208 203 6449
🌐 Visit: www.elimotors.co.uk
📍 Hendon, London

✨ Serving Hendon since 1979 ✨

Reply STOP to opt out.
```

5. **Template Variables**
   - `{{1}}` - Customer Name
   - `{{2}}` - Vehicle Registration
   - `{{3}}` - Service Due Date (formatted)
   - `{{4}}` - Days Until Service

6. **Submit for Approval**
   - Click "Submit for Approval"
   - WhatsApp typically approves utility templates within 24 hours
   - You'll receive an email when approved

7. **Get Template SID**
   - Once approved, go back to Content Editor
   - Find your template and copy the SID (starts with `HX`)
   - Update the code with the new SID

## Current Templates

### MOT Reminder (Already Active)
- **Name**: `mot_reminder_eli_motors`
- **SID**: `HX7989152000fc9771c99762c03f72785d`
- **Status**: ✅ Approved and Active

### Service Reminder (To Be Created)
- **Name**: `service_reminder_eli_motors`
- **SID**: Will be provided after approval
- **Status**: ⏳ Pending Creation

## After Approval

Once the Service template is approved, update the code in:
- `server/smsService.ts` - Add `sendServiceReminderWithTemplate` function
- `server/routers.ts` - Update `sendWhatsApp` mutation to use Service template

The template SID will look like: `HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
