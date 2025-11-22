import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MessageSquare, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";

export default function TestWhatsApp() {
  const [phoneNumber, setPhoneNumber] = useState("+447843275372");
  const [customMessage, setCustomMessage] = useState("");
  const [useCustomMessage, setUseCustomMessage] = useState(false);

  const testMutation = trpc.testWhatsApp.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`);
    },
  });

  const handleSendTest = () => {
    if (!phoneNumber) {
      toast.error("Please enter a phone number");
      return;
    }

    testMutation.mutate({
      phoneNumber,
      message: useCustomMessage && customMessage ? customMessage : undefined,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-8 h-8 text-green-600" />
              Test WhatsApp
            </h1>
            <p className="text-slate-600 mt-1">Send a test WhatsApp message to verify integration</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/">← Back to Home</Link>
          </Button>
        </div>

        {/* Info Card */}
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-blue-900">About WhatsApp Testing</CardTitle>
          </CardHeader>
          <CardContent className="text-blue-800">
            <p>
              This page allows you to test the WhatsApp integration by sending a test message to any phone number. 
              Make sure the number is in international format (e.g., +447843275372 for UK numbers).
            </p>
            <p className="mt-2">
              <strong>Note:</strong> The recipient must have WhatsApp installed and have previously messaged your 
              Twilio WhatsApp number, or you must have an approved WhatsApp Business template.
            </p>
          </CardContent>
        </Card>

        {/* Test Form */}
        <Card>
          <CardHeader>
            <CardTitle>Send Test Message</CardTitle>
            <CardDescription>Enter a phone number to receive the test WhatsApp message</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number (with country code)</Label>
              <Input
                id="phoneNumber"
                type="tel"
                placeholder="+447843275372"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="font-mono"
              />
              <p className="text-sm text-slate-500">
                Format: +[country code][number] (e.g., +447843275372 for UK)
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useCustomMessage"
                  checked={useCustomMessage}
                  onChange={(e) => setUseCustomMessage(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="useCustomMessage">Use custom message</Label>
              </div>
              
              {useCustomMessage && (
                <Textarea
                  placeholder="Enter your custom test message..."
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={4}
                />
              )}
              
              {!useCustomMessage && (
                <div className="p-3 bg-slate-50 rounded border text-sm text-slate-600">
                  Default message: "Test message from MOT Reminder Quick App. This is a test to verify 
                  WhatsApp integration is working correctly. Sent at [current time]."
                </div>
              )}
            </div>

            <Button
              onClick={handleSendTest}
              disabled={testMutation.isPending || !phoneNumber}
              className="w-full gap-2"
              size="lg"
            >
              {testMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <MessageSquare className="w-5 h-5" />
                  Send Test Message
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Result */}
        {testMutation.isSuccess && (
          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                Message Sent Successfully!
              </CardTitle>
            </CardHeader>
            <CardContent className="text-green-800">
              <p>The test WhatsApp message has been sent to {phoneNumber}.</p>
              {testMutation.data?.messageId && (
                <p className="mt-2 text-sm">Message ID: <code className="bg-green-100 px-2 py-1 rounded">{testMutation.data.messageId}</code></p>
              )}
            </CardContent>
          </Card>
        )}

        {testMutation.isError && (
          <Card className="border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-900 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Failed to Send Message
              </CardTitle>
            </CardHeader>
            <CardContent className="text-red-800">
              <p>{testMutation.error.message}</p>
              <div className="mt-4 space-y-2 text-sm">
                <p><strong>Common issues:</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Twilio credentials not configured in environment variables</li>
                  <li>WhatsApp number not verified in Twilio console</li>
                  <li>Recipient hasn't messaged your Twilio WhatsApp number first</li>
                  <li>Invalid phone number format</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Configuration Info */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Required environment variables for WhatsApp integration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <code className="bg-slate-100 px-2 py-1 rounded">TWILIO_ACCOUNT_SID</code>
                <span className="text-slate-600">- Your Twilio Account SID</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="bg-slate-100 px-2 py-1 rounded">TWILIO_AUTH_TOKEN</code>
                <span className="text-slate-600">- Your Twilio Auth Token</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="bg-slate-100 px-2 py-1 rounded">TWILIO_WHATSAPP_NUMBER</code>
                <span className="text-slate-600">- Your Twilio WhatsApp number (e.g., whatsapp:+14155238886)</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
