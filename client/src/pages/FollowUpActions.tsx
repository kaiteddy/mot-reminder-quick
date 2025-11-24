import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, Calendar, AlertCircle, CheckCircle2, MessageSquare } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChatHistory } from "@/components/ChatHistory";

export default function FollowUpActions() {
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  const { data: reminders, isLoading } = trpc.reminders.list.useQuery();
  const markRespondedMutation = trpc.reminders.markResponded.useMutation({
    onSuccess: () => {
      trpc.useUtils().reminders.list.invalidate();
    },
  });

  // Filter reminders that need follow-up
  const followUpReminders = reminders?.filter(r => r.needsFollowUp === 1) || [];

  // Sort by sentAt date (oldest first - highest priority)
  const sortedReminders = [...followUpReminders].sort((a, b) => {
    if (!a.sentAt || !b.sentAt) return 0;
    return new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
  });

  const handleMarkResponded = (id: number) => {
    markRespondedMutation.mutate({ id });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Follow-up Actions</h1>
          <p className="text-muted-foreground">
            Reminders sent over 7 days ago with no customer response
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Needs Follow-up
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">
                {followUpReminders.length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Reminders requiring action
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Oldest Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {sortedReminders.length > 0 && sortedReminders[0].sentAt
                  ? Math.floor((Date.now() - new Date(sortedReminders[0].sentAt).getTime()) / (1000 * 60 * 60 * 24))
                  : 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Days since sent
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Sent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {reminders?.filter(r => r.status === "sent").length || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                All sent reminders
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Follow-up List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              Reminders Needing Follow-up ({sortedReminders.length})
            </CardTitle>
            <CardDescription>
              These customers haven't responded within 7 days of the reminder being sent
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : sortedReminders.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
                <p className="text-lg font-semibold">All caught up!</p>
                <p className="text-muted-foreground">No reminders need follow-up at this time</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Priority</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Registration</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Days Ago</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedReminders.map((reminder, index) => {
                      const sentDate = reminder.sentAt ? new Date(reminder.sentAt) : null;
                      const dueDate = new Date(reminder.dueDate);
                      const daysSinceSent = sentDate 
                        ? Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24))
                        : null;

                      // Priority based on days since sent
                      const priority = daysSinceSent && daysSinceSent > 14 ? "high" : daysSinceSent && daysSinceSent > 10 ? "medium" : "normal";

                      return (
                        <TableRow key={reminder.id} className={priority === "high" ? "bg-red-50" : priority === "medium" ? "bg-orange-50" : ""}>
                          <TableCell>
                            <Badge 
                              variant={priority === "high" ? "destructive" : priority === "medium" ? "default" : "secondary"}
                              className="gap-1"
                            >
                              <Clock className="h-3 w-3" />
                              {priority === "high" ? "High" : priority === "medium" ? "Medium" : "Normal"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{reminder.type}</Badge>
                          </TableCell>
                          <TableCell className="font-mono font-semibold">
                            {reminder.registration}
                          </TableCell>
                          <TableCell>{reminder.customerName || "-"}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {reminder.customerPhone || "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm">
                              <Calendar className="h-3 w-3" />
                              {dueDate.toLocaleDateString("en-GB")}
                            </div>
                          </TableCell>
                          <TableCell>
                            {sentDate ? (
                              <div className="text-sm">
                                {sentDate.toLocaleDateString("en-GB")}
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-semibold text-orange-600">
                              {daysSinceSent !== null ? `${daysSinceSent} days` : "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              {reminder.customerPhone && (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setSelectedPhone(reminder.customerPhone)}
                                    >
                                      <MessageSquare className="h-4 w-4 mr-1" />
                                      Chat
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-3xl max-h-[90vh]">
                                    <DialogHeader>
                                      <DialogTitle>Chat with {reminder.customerName || reminder.customerPhone}</DialogTitle>
                                      <DialogDescription>
                                        {reminder.registration} - {reminder.vehicleMake} {reminder.vehicleModel}
                                      </DialogDescription>
                                    </DialogHeader>
                                    <ChatHistory phoneNumber={reminder.customerPhone} />
                                  </DialogContent>
                                </Dialog>
                              )}
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleMarkResponded(reminder.id)}
                                disabled={markRespondedMutation.isPending}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                Mark Responded
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
