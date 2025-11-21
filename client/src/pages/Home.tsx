import { useState } from "react";
import type { Reminder } from "../../../drizzle/schema";
import { ImageUpload } from "@/components/ImageUpload";
import { EditReminderDialog } from "@/components/EditReminderDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Car, Mail, Phone, Plus, Send, Trash2, Loader2, Search } from "lucide-react";
import { APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { formatMOTDate, getMOTStatusBadge, formatDaysUntilExpiry } from "@/lib/motUtils";

export default function Home() {
  const [showUpload, setShowUpload] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);

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
          <div className="flex gap-3">
            <Link href="/mot-check">
              <Button variant="outline" size="lg">
                <Search className="w-4 h-4 mr-2" />
                MOT Check
              </Button>
            </Link>
            <Button onClick={() => setShowUpload(!showUpload)} size="lg">
              <Plus className="w-4 h-4 mr-2" />
              Upload Screenshot
            </Button>
          </div>
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
                  <ReminderCard
                    key={reminder.id}
                    reminder={reminder}
                    urgent
                    onEdit={() => setEditingReminder(reminder)}
                  />
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
                  <ReminderCard
                    key={reminder.id}
                    reminder={reminder}
                    onEdit={() => setEditingReminder(reminder)}
                  />
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

        {/* Edit Dialog */}
        {editingReminder && (
          <EditReminderDialog
            reminder={editingReminder}
            open={!!editingReminder}
            onOpenChange={(open) => !open && setEditingReminder(null)}
            onSuccess={() => {
              utils.reminders.list.invalidate();
              setEditingReminder(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function SendWhatsAppButton({ reminder }: { reminder: Reminder }) {
  const utils = trpc.useUtils();
  const sendMutation = trpc.reminders.sendWhatsApp.useMutation({
    onSuccess: () => {
      toast.success("WhatsApp message sent successfully");
      utils.reminders.list.invalidate();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const handleSend = () => {
    if (!reminder.customerPhone) {
      toast.error("No phone number available");
      return;
    }
    
    const confirmed = confirm(
      `Send WhatsApp reminder to ${reminder.customerName || "customer"} at ${reminder.customerPhone}?`
    );
    
    if (confirmed) {
      sendMutation.mutate({
        id: reminder.id,
        phoneNumber: reminder.customerPhone,
      });
    }
  };

  return (
    <Button
      variant="default"
      size="sm"
      onClick={handleSend}
      disabled={!reminder.customerPhone || sendMutation.isPending || reminder.status === "sent"}
    >
      {sendMutation.isPending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <>
          <Send className="w-4 h-4 mr-1" />
          {reminder.status === "sent" ? "Sent" : "Send"}
        </>
      )}
    </Button>
  );
}

function DeleteButton({ reminderId }: { reminderId: number }) {
  const utils = trpc.useUtils();
  const deleteMutation = trpc.reminders.delete.useMutation({
    onSuccess: () => {
      toast.success("Reminder deleted");
      utils.reminders.list.invalidate();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const handleDelete = () => {
    const confirmed = confirm("Are you sure you want to delete this reminder?");
    if (confirmed) {
      deleteMutation.mutate({ id: reminderId });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      disabled={deleteMutation.isPending}
    >
      {deleteMutation.isPending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Trash2 className="w-4 h-4" />
      )}
    </Button>
  );
}

function ReminderCard({
  reminder,
  urgent,
  onEdit,
}: {
  reminder: Reminder;
  urgent?: boolean;
  onEdit: () => void;
}) {
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
            {(() => {
              const motInfo = formatMOTDate(reminder.dueDate);
              if (typeof motInfo === 'string') return null;
              const badge = getMOTStatusBadge(motInfo);
              return (
                <Badge variant={badge.variant} className={badge.className}>
                  {motInfo.isExpired
                    ? `Expired ${Math.abs(motInfo.daysUntilExpiry)}d ago`
                    : motInfo.daysUntilExpiry === 0
                    ? "Due today"
                    : `${motInfo.daysUntilExpiry}d left`}
                </Badge>
              );
            })()}
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

        <div className="flex gap-2">
          <SendWhatsAppButton reminder={reminder} />
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <DeleteButton reminderId={reminder.id} />
        </div>
      </div>
    </div>
  );
}
