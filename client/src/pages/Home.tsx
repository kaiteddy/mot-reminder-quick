import { useState, useEffect } from "react";
import type { Reminder } from "../../../drizzle/schema";
import { ImageUpload } from "@/components/ImageUpload";
import { UnifiedVehicleTable } from "@/components/UnifiedVehicleTable";
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
import { Input } from "@/components/ui/input";
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
    onSuccess: (data: { count: number; total: any; errors: string[] }) => {
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

  const [searchTerm, setSearchTerm] = useState("");

  const filteredReminders = allReminders.filter((r: Reminder) => {
    const search = searchTerm.toLowerCase();
    return (
      (r.registration?.toLowerCase().includes(search) ?? false) ||
      (r.customerName?.toLowerCase().includes(search) ?? false) ||
      (r.vehicleMake?.toLowerCase().includes(search) ?? false) ||
      (r.vehicleModel?.toLowerCase().includes(search) ?? false)
    );
  });

  const dueNowFiltered = dueNow.filter((r: Reminder) => {
    const search = searchTerm.toLowerCase();
    return (
      (r.registration?.toLowerCase().includes(search) ?? false) ||
      (r.customerName?.toLowerCase().includes(search) ?? false)
    );
  });

  const visibleVehicleIds = Array.from(new Set(filteredReminders.map((r: Reminder) => r.vehicleId).filter((id): id is number => id !== null)));

  const needsCheckCount = allReminders.filter((r: any) => {
    if (!r.lastChecked) return true;
    const lastChecked = new Date(r.lastChecked);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return lastChecked < thirtyDaysAgo;
  }).length;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">{APP_TITLE}</h1>
            <p className="text-muted-foreground mt-2">
              Quick MOT reminders from screenshots
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <MOTRefreshButton
              vehicleIds={visibleVehicleIds}
              label="Refresh Visible MOT & Tax"
              variant="outline"
              size="lg"
              onComplete={() => utils.reminders.list.invalidate()}
            />
            <Button onClick={() => setShowUpload(!showUpload)} size="lg">
              <Plus className="w-4 h-4 mr-2" />
              Upload Screenshot
            </Button>
          </div>
        </div>

        {/* Global Search & Batch Actions */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by registration, customer, make or model..."
              value={searchTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
              className="pl-9 h-12 text-lg"
            />
          </div>
          <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg border">
            <div className="flex flex-col px-2">
              <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">Ready to Refresh</span>
              <span className="text-sm font-semibold text-primary">{needsCheckCount} vehicles</span>
            </div>
            <div className="h-8 w-[1px] bg-border mx-1" />
            <MOTRefreshButton
              limit={100}
              label="100"
              variant="secondary"
              size="sm"
              onComplete={() => utils.reminders.list.invalidate()}
            />
            <MOTRefreshButton
              limit={200}
              label="200"
              variant="secondary"
              size="sm"
              onComplete={() => utils.reminders.list.invalidate()}
            />
            <MOTRefreshButton
              limit={300}
              label="300"
              variant="secondary"
              size="sm"
              onComplete={() => utils.reminders.list.invalidate()}
            />
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
        {dueNowFiltered.length > 0 && (
          <Card className="border-orange-200 bg-orange-50/50">
            <CardHeader>
              <CardTitle className="text-orange-900">
                ⚠️ Reminders Due Now ({dueNowFiltered.length})
              </CardTitle>
              <CardDescription>
                These reminders are overdue or due within the next 7 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UnifiedVehicleTable
                data={dueNowFiltered as any}
                onEdit={(reminder) => setEditingReminder(reminder as any)}
                refetch={() => utils.reminders.list.invalidate()}
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
                  {filteredReminders.length} total reminders {searchTerm && `matching "${searchTerm}"`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading reminders...
              </div>
            ) : filteredReminders.length > 0 ? (
              <UnifiedVehicleTable
                data={filteredReminders as any}
                onEdit={(reminder) => setEditingReminder(reminder as any)}
                refetch={() => utils.reminders.list.invalidate()}
              />
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{searchTerm ? "No reminders match your search" : "No reminders yet"}</p>
                {!searchTerm && (
                  <p className="text-sm mt-2">
                    Upload a screenshot to get started
                  </p>
                )}
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
