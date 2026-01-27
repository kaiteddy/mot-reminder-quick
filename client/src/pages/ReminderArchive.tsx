import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DashboardLayout from "@/components/DashboardLayout";
import { UnifiedVehicleTable, VehicleData } from "@/components/UnifiedVehicleTable";

export default function ReminderArchive() {
  const { data: reminders, isLoading } = trpc.reminders.list.useQuery();
  const utils = trpc.useUtils();

  const markRespondedMutation = trpc.reminders.markResponded.useMutation({
    onSuccess: () => {
      utils.reminders.list.invalidate();
    },
  });

  // Filter sent and archived reminders
  const archivedReminders = (reminders?.filter(r => r.status === "sent" || r.status === "archived") || []).map(r => ({
    ...r,
    vehicleMake: r.vehicleMake || null,
    vehicleModel: r.vehicleModel || null,
    customerPhone: r.customerPhone || null,
    customerName: r.customerName || null,
    customerId: r.customerId || null,
  })) as VehicleData[];

  const handleMarkResponded = (id: number) => {
    markRespondedMutation.mutate({ id });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Reminder Archive</h1>
          <p className="text-muted-foreground">
            View and search all sent reminders
          </p>
        </div>

        {/* Reminders Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle>Sent Reminders ({archivedReminders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <UnifiedVehicleTable
              data={archivedReminders}
              isLoading={isLoading}
              onMarkResponded={handleMarkResponded}
              showFilters={true}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
