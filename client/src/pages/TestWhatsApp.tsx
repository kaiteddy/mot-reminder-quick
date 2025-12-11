import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";

type TemplateType = "MOT" | "MOT_EXPIRED" | "Service";

export default function TestWhatsApp() {
  const [phoneNumber, setPhoneNumber] = useState("+447843275372");
  const [templateType, setTemplateType] = useState<TemplateType>("MOT");
  const [customerName, setCustomerName] = useState("Test Customer");
  const [registration, setRegistration] = useState("TEST123");
  const [expiryDate, setExpiryDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14); // 14 days from now
    return date.toISOString().split('T')[0];
  });

  const sendMutation = trpc.reminders.sendWhatsApp.useMutation({
    onSuccess: () => {
      toast.success("Test message sent successfully!");
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
    if (!customerName || !registration || !expiryDate) {
      toast.error("Please fill in all fields");
      return;
    }

    // Calculate days until expiry
    const expiry = new Date(expiryDate);
    const today = new Date();
    const daysUntil = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // For MOT_EXPIRED, set the expiry date to past to trigger the expired template
    let actualExpiryDate = expiryDate;
    if (templateType === "MOT_EXPIRED") {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30); // 30 days ago
      actualExpiryDate = pastDate.toISOString().split('T')[0];
    }

    // Send using the template system (id: 0 means test message)
    sendMutation.mutate({
      id: 0,
      phoneNumber,
      customerName,
      registration,
      expiryDate: actualExpiryDate,
      daysUntil,
      messageType: templateType === "MOT_EXPIRED" ? "MOT" : templateType,
    });
  };

  // Determine which template will be used based on expiry date
  const getActiveTemplate = () => {
    if (templateType === "Service") return "servicereminder";
    if (templateType === "MOT_EXPIRED") return "copy_motreminder";
    
    // For MOT, check if date is in past
    const expiry = new Date(expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    
    return expiry < today ? "copy_motreminder" : "motreminder";
  };

  const activeTemplate = getActiveTemplate();
  const daysUntilExpiry = Math.ceil((new Date(expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isExpired = daysUntilExpiry < 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-8 h-8 text-green-600" />
              Test WhatsApp Templates
            </h1>
            <p className="text-slate-600 mt-1">Send a test message using approved WhatsApp templates</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/">← Back to Home</Link>
          </Button>
        </div>

        {/* Info Card */}
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-blue-900">About WhatsApp Templates</CardTitle>
          </CardHeader>
          <CardContent className="text-blue-800 space-y-2">
            <p>
              WhatsApp requires approved message templates for business messaging. This page uses the 
              same templates as the main app to ensure messages are delivered successfully.
            </p>
            <p>
              <strong>Available Templates:</strong>
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li><strong>MOT Reminder</strong> - Notifies customers about upcoming MOT expiry</li>
              <li><strong>MOT Expired</strong> - Notifies customers that their MOT has already expired</li>
              <li><strong>Service Reminder</strong> - Notifies customers about upcoming service due date</li>
            </ul>
          </CardContent>
        </Card>

        {/* Active Template Indicator */}
        {templateType === "MOT" && (
          <Card className={`border-2 ${isExpired ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'}`}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${isExpired ? 'text-red-900' : 'text-green-900'}`}>
                <AlertCircle className="w-5 h-5" />
                Active Template: {activeTemplate === "copy_motreminder" ? "MOT Expired" : "MOT Reminder"}
              </CardTitle>
            </CardHeader>
            <CardContent className={isExpired ? 'text-red-800' : 'text-green-800'}>
              <p>
                {isExpired 
                  ? `The expiry date is in the past, so the "copy_motreminder" template will be used for expired MOTs.`
                  : `The expiry date is in the future, so the "motreminder" template will be used for upcoming MOTs.`
                }
              </p>
            </CardContent>
          </Card>
        )}

        {/* Test Form */}
        <Card>
          <CardHeader>
            <CardTitle>Send Test Message</CardTitle>
            <CardDescription>Fill in the details to send a test WhatsApp message</CardDescription>
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
              <Label htmlFor="templateType">Template Type</Label>
              <Select value={templateType} onValueChange={(value) => setTemplateType(value as TemplateType)}>
                <SelectTrigger id="templateType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MOT">MOT Reminder (Auto-select based on date)</SelectItem>
                  <SelectItem value="MOT_EXPIRED">MOT Expired (Force expired template)</SelectItem>
                  <SelectItem value="Service">Service Reminder</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-slate-500">
                {templateType === "MOT" 
                  ? "Automatically selects expired or reminder template based on expiry date"
                  : templateType === "MOT_EXPIRED"
                  ? "Forces the expired template regardless of date entered"
                  : "Uses the service reminder template"
                }
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerName">Customer Name</Label>
                <Input
                  id="customerName"
                  placeholder="John Smith"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="registration">Vehicle Registration</Label>
                <Input
                  id="registration"
                  placeholder="AB12 CDE"
                  value={registration}
                  onChange={(e) => setRegistration(e.target.value.toUpperCase())}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiryDate">
                {templateType === "Service" ? "Service Due Date" : "MOT Expiry Date"}
              </Label>
              <Input
                id="expiryDate"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                disabled={templateType === "MOT_EXPIRED"}
              />
              {templateType === "MOT_EXPIRED" && (
                <p className="text-sm text-slate-500">
                  Date is ignored for expired template test - will use a past date automatically
                </p>
              )}
            </div>

            {/* Preview */}
            <div className="p-4 bg-slate-50 rounded border space-y-2">
              <p className="text-sm font-medium text-slate-700">Message Preview:</p>
              <p className="text-sm text-slate-600">
                {templateType === "Service" 
                  ? `Hi ${customerName}, this is a reminder that the service for your vehicle ${registration} is due on ${new Date(expiryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} (${daysUntilExpiry} days). Please contact us to book your service.`
                  : templateType === "MOT_EXPIRED" || isExpired
                  ? `Hi ${customerName}, your vehicle ${registration} MOT expired on ${new Date(expiryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}. Please contact us to book your MOT test.`
                  : `Hi ${customerName}, this is a reminder that the MOT for your vehicle ${registration} expires on ${new Date(expiryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} (${daysUntilExpiry} days). Please contact us to book your MOT test.`
                }
              </p>
            </div>

            <Button
              onClick={handleSendTest}
              disabled={sendMutation.isPending || !phoneNumber || !customerName || !registration || !expiryDate}
              className="w-full gap-2"
              size="lg"
            >
              {sendMutation.isPending ? (
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
        {sendMutation.isSuccess && (
          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                Message Sent Successfully!
              </CardTitle>
            </CardHeader>
            <CardContent className="text-green-800">
              <p>The test WhatsApp message has been sent to {phoneNumber}.</p>
              <p className="mt-2 text-sm">
                You can view this message in the <Link href="/logs" className="underline font-medium">Logs & Messages</Link> page.
              </p>
            </CardContent>
          </Card>
        )}

        {sendMutation.isError && (
          <Card className="border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-900 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Failed to Send Message
              </CardTitle>
            </CardHeader>
            <CardContent className="text-red-800">
              <p>{sendMutation.error.message}</p>
              <div className="mt-4 space-y-2 text-sm">
                <p><strong>Common issues:</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Twilio credentials not configured in environment variables</li>
                  <li>WhatsApp template not approved in Twilio console</li>
                  <li>Invalid phone number format</li>
                  <li>Recipient phone number not reachable</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Configuration Info */}
        <Card>
          <CardHeader>
            <CardTitle>Approved Templates</CardTitle>
            <CardDescription>WhatsApp templates configured in Twilio</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="p-3 bg-slate-50 rounded border">
                <p className="font-medium mb-1">MOT Reminder Template (Expiring Soon)</p>
                <p className="text-slate-600">SID: HX127c47f8a63b992d86b43943394a1740</p>
                <p className="text-slate-600 mt-1">Name: motreminder</p>
                <p className="text-slate-600 mt-1">Variables: Customer name, Registration, Expiry date, Days until expiry</p>
              </div>
              <div className="p-3 bg-slate-50 rounded border">
                <p className="font-medium mb-1">MOT Expired Template</p>
                <p className="text-slate-600">SID: HX0a553ba697cdc3acce4a935f5d462ada</p>
                <p className="text-slate-600 mt-1">Name: copy_motreminder</p>
                <p className="text-slate-600 mt-1">Variables: Customer name, Registration, Expiry date</p>
              </div>
              <div className="p-3 bg-slate-50 rounded border">
                <p className="font-medium mb-1">Service Reminder Template</p>
                <p className="text-slate-600">SID: HXac307a9bd92b65df83038c2b2a3eeeff</p>
                <p className="text-slate-600 mt-1">Name: servicereminder</p>
                <p className="text-slate-600 mt-1">Variables: Customer name, Registration, Service due date, Days until due</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
