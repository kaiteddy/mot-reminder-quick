import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Calendar, CheckCircle2, Clock } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function ReminderArchive() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "responded" | "needs_followup">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "MOT" | "Service" | "Cambelt" | "Other">("all");

  const { data: reminders, isLoading } = trpc.reminders.list.useQuery();
  const markRespondedMutation = trpc.reminders.markResponded.useMutation({
    onSuccess: () => {
      trpc.useUtils().reminders.list.invalidate();
    },
  });

  // Filter sent and archived reminders
  const archivedReminders = reminders?.filter(r => r.status === "sent" || r.status === "archived") || [];

  // Apply search and filters
  const filteredReminders = archivedReminders.filter(reminder => {
    // Search filter
    const matchesSearch = 
      reminder.registration.toLowerCase().includes(searchTerm.toLowerCase()) ||
      reminder.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      reminder.customerPhone?.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    // Type filter
    if (typeFilter !== "all" && reminder.type !== typeFilter) return false;

    // Status filter
    if (statusFilter === "responded" && !reminder.customerResponded) return false;
    if (statusFilter === "needs_followup" && !reminder.needsFollowUp) return false;
    if (statusFilter === "sent" && (reminder.customerResponded || reminder.needsFollowUp)) return false;

    return true;
  });

  // Sort by sentAt date (newest first)
  const sortedReminders = [...filteredReminders].sort((a, b) => {
    if (!a.sentAt || !b.sentAt) return 0;
    return new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
  });

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

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Search & Filter</CardTitle>
            <CardDescription>
              Find specific reminders by registration, customer, or status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search registration, customer..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Type Filter */}
              <Select value={typeFilter} onValueChange={(value: any) => setTypeFilter(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="MOT">MOT</SelectItem>
                  <SelectItem value="Service">Service</SelectItem>
                  <SelectItem value="Cambelt">Cambelt</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="sent">Sent (No Response)</SelectItem>
                  <SelectItem value="responded">Customer Responded</SelectItem>
                  <SelectItem value="needs_followup">Needs Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Results count */}
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {sortedReminders.length} of {archivedReminders.length} sent reminders
            </div>
          </CardContent>
        </Card>

        {/* Reminders Table */}
        <Card>
          <CardHeader>
            <CardTitle>Sent Reminders ({sortedReminders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : sortedReminders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No sent reminders found
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Registration</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Sent At</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedReminders.map((reminder) => {
                      const sentDate = reminder.sentAt ? new Date(reminder.sentAt) : null;
                      const dueDate = new Date(reminder.dueDate);
                      const daysSinceSent = sentDate 
                        ? Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24))
                        : null;

                      return (
                        <TableRow key={reminder.id}>
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
                                <div>{sentDate.toLocaleDateString("en-GB")}</div>
                                <div className="text-xs text-muted-foreground">
                                  {daysSinceSent !== null && `${daysSinceSent} days ago`}
                                </div>
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {reminder.customerResponded ? (
                                <Badge variant="default" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Responded
                                </Badge>
                              ) : reminder.needsFollowUp ? (
                                <Badge variant="destructive" className="gap-1">
                                  <Clock className="h-3 w-3" />
                                  Follow-up
                                </Badge>
                              ) : (
                                <Badge variant="secondary">Sent</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {!reminder.customerResponded && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleMarkResponded(reminder.id)}
                                disabled={markRespondedMutation.isPending}
                              >
                                Mark Responded
                              </Button>
                            )}
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
