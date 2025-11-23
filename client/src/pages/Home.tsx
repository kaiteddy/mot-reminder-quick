import { useState } from "react";
import type { Reminder } from "../../../drizzle/schema";
import { ImageUpload } from "@/components/ImageUpload";
import { RemindersTable } from "@/components/RemindersTable";
import { EditReminderDialog } from "@/components/EditReminderDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Plus, Search, Upload, Users, Car, Database, MessageSquare, FileText } from "lucide-react";
import { APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";

export default function Home() {
  const [showUpload, setShowUpload] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);

  const utils = trpc.useUtils();
  // Use auto-generated reminders from vehicles instead of manual reminders
  const { data: reminders, isLoading } = trpc.reminders.generateFromVehicles.useQuery();
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
            <Link href="/database">
              <Button variant="outline" size="lg">
                <Database className="w-4 h-4 mr-2" />
                Database
              </Button>
            </Link>
            <Link href="/customers">
              <Button variant="outline" size="lg">
                <Users className="w-4 h-4 mr-2" />
                Customers
              </Button>
            </Link>
            <Link href="/vehicles">
              <Button variant="outline" size="lg">
                <Car className="w-4 h-4 mr-2" />
                Vehicles
              </Button>
            </Link>
            <Link href="/mot-check">
              <Button variant="outline" size="lg">
                <Search className="w-4 h-4 mr-2" />
                MOT Check
              </Button>
            </Link>
            <Link href="/import">
              <Button variant="outline" size="lg">
                <Upload className="w-4 h-4 mr-2" />
                Import from GA4
              </Button>
            </Link>
            <Link href="/test-whatsapp">
              <Button variant="outline" size="lg">
                <MessageSquare className="w-4 h-4 mr-2" />
                Test WhatsApp
              </Button>
            </Link>
            <Link href="/logs">
              <Button variant="outline" size="lg">
                <FileText className="w-4 h-4 mr-2" />
                Logs & Messages
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
            <CardTitle>All Reminders</CardTitle>
            <CardDescription>
              {allReminders.length} total reminders
            </CardDescription>
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
    </div>
  );
}
