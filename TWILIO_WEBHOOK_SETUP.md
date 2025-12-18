# Twilio Webhook Setup Guide

This guide explains how to configure Twilio webhooks for the MOT Reminder system.

## Webhook Configuration

Configure these webhook URLs in your Twilio Console:

**Incoming Messages Webhook:**
```
https://your-domain.com/api/webhooks/twilio
```

**Status Callback Webhook:**
```
https://your-domain.com/api/webhooks/twilio/status
```

## Setup Instructions

1. Log in to [Twilio Console](https://console.twilio.com/)
2. Navigate to Messaging > Settings > WhatsApp Sandbox (for testing) or your WhatsApp sender
3. Configure the webhook URLs above
4. Set HTTP method to POST
5. Save configuration

## Testing

Send a test message to verify webhook connectivity.

For production deployment, replace `your-domain.com` with your actual production domain.
