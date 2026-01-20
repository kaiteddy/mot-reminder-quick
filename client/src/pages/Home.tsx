import { useState, useEffect } from "react";
import type { Reminder } from "../../../drizzle/schema";
import { ImageUpload } from "@/components/ImageUpload";
import { RemindersTable } from "@/components/RemindersTable";
import { EditReminderDialog } from "@/components/EditReminderDialog";
import { UnreadMessageBadge } from "@/components/UnreadMessageBadge";
import { MOTRefreshButton } from "@/components/MOTRefreshButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Plus, Search, Upload, Users, Car, Database, MessageSquare, FileText, Wrench, RefreshCw, CheckCircle } from "lucide-react";
import { APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

export default function Home() {
  const [showUpload, setShowUpload] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);


  const utils = trpc.useUtils();

  // Auto-update follow-up flags on mount and every 5 minutes
  const updateFollowUpMutation = trpc.reminders.updateFollowUpFlags.useMutation();

  useEffect(() => {
    // Update on mount
    updateFollowUpMutation.mutate();

    // Update every 5 minutes
    const interval = setInterval(() => {
      updateFollowUpMutation.mutate();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Use auto-generated reminders from vehicles instead of manual reminders
  // This ensures we always have up-to-date data based on vehicle MOT dates
  const { data: reminders, isLoading, error: remindersError } = trpc.reminders.list.useQuery(undefined, {
    retry: 2,
    retryDelay: 1000,
  });

  // Show error toast if query fails
  useEffect(() => {
    if (remindersError) {
      console.error("[Home] Error loading reminders:", remindersError);
      toast.error("Failed to load reminders. Please refresh the page.");
    }
  }, [remindersError]);
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

  const allReminders = reminders || [];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">{APP_TITLE}</h1>
            <p className="text-muted-foreground mt-2">
              Quick MOT reminders from screenshots
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
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
                These reminders are overdue or due within the next 7 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RemindersTable
                reminders={dueNow}
                onEdit={(reminder) => setEditingReminder(reminder)}
              />
            </CardContent>
          </Card>
        )}

        {/* All Reminders */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Reminders</CardTitle>
                <CardDescription>
                  {allReminders.length} total reminders
                </CardDescription>
              </div>
              <MOTRefreshButton
                vehicleIds={Array.from(new Set(allReminders.map((r: Reminder) => r.vehicleId).filter((id): id is number => id !== null)))}
                label="Refresh MOT & Tax"
                variant="outline"
                size="sm"
                onComplete={() => utils.reminders.generateFromVehicles.invalidate()}
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading reminders...
              </div>
            ) : allReminders.length > 0 ? (
              <RemindersTable
                reminders={allReminders}
                onEdit={(reminder) => setEditingReminder(reminder)}
              />
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
    </DashboardLayout>
  );
}
