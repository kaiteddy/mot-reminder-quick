# Twilio Webhook Configuration

This guide explains how to configure Twilio webhooks to receive incoming WhatsApp messages and delivery status updates.

## Webhook Endpoints

Your MOT Reminder app exposes two webhook endpoints:

### 1. Incoming Messages Webhook
**URL:** `https://your-domain.com/api/webhooks/twilio`

This endpoint receives incoming WhatsApp messages from customers who reply to your reminders.

### 2. Status Callback Webhook
**URL:** `https://your-domain.com/api/webhooks/twilio/status`

This endpoint receives delivery status updates (sent, delivered, failed, etc.) for outgoing messages.

## Configuration Steps

### Step 1: Get Your Current Server URL

**IMPORTANT**: Your server is running on **port 3000**, not 3001.

Current server URL: `https://3000-ii1710lkmx9houx1sir69-8c75b868.manusvm.computer`

⚠️ **Common Mistake**: Using port 3001 will cause 502 Bad Gateway errors!

### Step 2: Configure WhatsApp Sender in Twilio Console

1. Go to [Twilio Console - WhatsApp Senders](https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders)

2. Click on your WhatsApp sender: **+15558340240**

3. Under **"Webhook for incoming messages"**, set:
   ```
   https://3000-ii1710lkmx9houx1sir69-8c75b868.manusvm.computer/api/webhooks/twilio
   ```
   Method: `POST`

4. Under **"Status callback URL"**, set:
   ```
   https://3000-ii1710lkmx9houx1sir69-8c75b868.manusvm.computer/api/webhooks/twilio/status
   ```
   Method: `POST`

4. Click **Save**

### Step 3: Configure Status Callbacks (Optional but Recommended)

When sending messages via the API, you can include a StatusCallback URL parameter. This is already configured in the app's SMS service.

The app automatically includes the status callback URL when sending messages, so no additional configuration is needed in Twilio Console.

## Testing Webhooks

### Test Incoming Messages

1. Send a WhatsApp message to your Twilio number: **+15558340240**

2. Check your app logs for:
   ```
   [Twilio Webhook] Received: { messageSid: '...', from: '...', body: '...' }
   ```

3. You should receive an automatic reply: "Thank you for your message. We'll get back to you soon."

### Test Status Callbacks

1. Send a reminder from your app

2. Check your app logs for status updates:
   ```
   [Twilio Status] Received: { messageSid: '...', status: 'delivered' }
   ```

## Webhook Security (Recommended for Production)

To verify that webhook requests are genuinely from Twilio, you should validate the X-Twilio-Signature header.

Add this to your environment variables:
```
TWILIO_AUTH_TOKEN=37d4181756beb9ba049079bf43b0a51f
```

The webhook handler can then verify the signature using Twilio's validation library.

## Troubleshooting

### Webhook Not Receiving Requests

1. **Check URL is publicly accessible**: Twilio cannot reach localhost or private networks
2. **Verify HTTPS**: Twilio requires HTTPS for webhooks (HTTP won't work)
3. **Check Twilio Console logs**: Go to Monitor > Logs > Errors to see webhook failures
4. **Test with curl**:
   ```bash
   curl -X POST https://your-domain.com/api/webhooks/twilio \
     -d "MessageSid=TEST123" \
     -d "From=whatsapp:+447123456789" \
     -d "To=whatsapp:+15558340240" \
     -d "Body=Test message"
   ```

### Messages Not Showing Status Updates

1. Ensure the status callback URL is included when sending messages (already configured in the app)
2. Check Twilio Console logs for delivery failures
3. Verify the recipient's phone number is correctly formatted with country code

## Current Configuration

**Twilio Account SID:** AC1572c0e5e4b55bb7440c3d9da482fd36  
**Twilio WhatsApp Number:** +15558340240  
**Webhook Endpoints:**
- Incoming: `/api/webhooks/twilio`
- Status: `/api/webhooks/twilio/status`

## Next Steps

After configuring webhooks:

1. **Deploy your app** to get a production URL
2. **Update Twilio Console** with your production webhook URLs
3. **Test** by sending a WhatsApp message to your Twilio number
4. **Monitor logs** to ensure webhooks are working correctly
