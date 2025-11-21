import { useState } from "react";
import type { Reminder } from "../../../drizzle/schema";
import { ImageUpload } from "@/components/ImageUpload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Car, Mail, Phone, Plus } from "lucide-react";
import { APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Home() {
  const [showUpload, setShowUpload] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const utils = trpc.useUtils();
  const { data: reminders, isLoading } = trpc.reminders.list.useQuery();
  const processImage = trpc.reminders.processImage.useMutation({
    onSuccess: (data) => {
      toast.success(`Extracted ${data.count} reminders`);
      utils.reminders.list.invalidate();
      setShowUpload(false);
      setIsProcessing(false);
    },
    onError: (error: any) => {
      toast.error(error.message);
      setIsProcessing(false);
    },
  });

  const handleImageUpload = async (file: File) => {
    setIsProcessing(true);
    
    // Convert file to base64
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      processImage.mutate({ imageData: base64 });
    };
    reader.readAsDataURL(file);
  };

  const dueNow = reminders?.filter((r: Reminder) => {
    const dueDate = new Date(r.dueDate);
    const today = new Date();
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 7 && r.status === "pending";
  }) || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">{APP_TITLE}</h1>
            <p className="text-muted-foreground mt-2">
              Quick MOT reminders from screenshots
            </p>
          </div>
          <Button onClick={() => setShowUpload(!showUpload)} size="lg">
            <Plus className="w-4 h-4 mr-2" />
            Upload Screenshot
          </Button>
        </div>

        {/* Upload Section */}
        {showUpload && (
          <ImageUpload
            onImageUpload={handleImageUpload}
            isProcessing={isProcessing}
          />
        )}

        {/* Due Now Section */}
        {dueNow.length > 0 && (
          <Card className="border-orange-200 bg-orange-50/50">
            <CardHeader>
              <CardTitle className="text-orange-900">
                ⚠️ Reminders Due Now ({dueNow.length})
              </CardTitle>
              <CardDescription>
                These reminders are due within the next 7 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {dueNow.map((reminder) => (
                  <ReminderCard key={reminder.id} reminder={reminder} urgent />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* All Reminders */}
        <Card>
          <CardHeader>
            <CardTitle>All Reminders</CardTitle>
            <CardDescription>
              {reminders?.length || 0} total reminders
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading reminders...
              </div>
            ) : reminders && reminders.length > 0 ? (
              <div className="space-y-3">
                {reminders.map((reminder: Reminder) => (
                  <ReminderCard key={reminder.id} reminder={reminder} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No reminders yet</p>
                <p className="text-sm mt-2">
                  Upload a screenshot to get started
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReminderCard({ reminder, urgent }: { reminder: Reminder; urgent?: boolean }) {
  const dueDate = new Date(reminder.dueDate);
  const formattedDate = dueDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div
      className={`p-4 rounded-lg border ${
        urgent ? "border-orange-300 bg-white" : "border-border bg-card"
      } hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={reminder.type === "MOT" ? "default" : "secondary"}>
              {reminder.type}
            </Badge>
            <Badge variant={reminder.status === "pending" ? "outline" : "secondary"}>
              {reminder.status}
            </Badge>
            <span className="text-sm font-medium">{formattedDate}</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Car className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">{reminder.registration}</span>
            {reminder.vehicleMake && (
              <span className="text-muted-foreground">
                {reminder.vehicleMake} {reminder.vehicleModel}
              </span>
            )}
          </div>

          {reminder.customerName && (
            <div className="text-sm text-muted-foreground space-y-1">
              <div>{reminder.customerName}</div>
              {reminder.customerEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="w-3 h-3" />
                  {reminder.customerEmail}
                </div>
              )}
              {reminder.customerPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-3 h-3" />
                  {reminder.customerPhone}
                </div>
              )}
            </div>
          )}
        </div>

        <Button variant="outline" size="sm">
          Edit
        </Button>
      </div>
    </div>
  );
}
