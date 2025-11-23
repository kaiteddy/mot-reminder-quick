import { useState, useMemo } from "react";
import type { Reminder } from "../../../drizzle/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Send, Trash2, Loader2, Pencil, ArrowUpDown, ArrowUp, ArrowDown, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatMOTDate, getMOTStatusBadge } from "@/lib/motUtils";

interface RemindersTableProps {
  reminders: Reminder[];
  onEdit: (reminder: Reminder) => void;
}

type SortColumn = "type" | "dueDate" | "registration" | "customer" | "motExpiry" | "daysLeft" | "status";
type SortDirection = "asc" | "desc";

export function RemindersTable({ reminders, onEdit }: RemindersTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>("dueDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-4 h-4 ml-1 opacity-30" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="w-4 h-4 ml-1" />
    ) : (
      <ArrowDown className="w-4 h-4 ml-1" />
    );
  };

  // Filter reminders
  let filteredReminders = reminders;
  
  if (typeFilter !== "all") {
    filteredReminders = filteredReminders.filter(r => r.type.toLowerCase() === typeFilter);
  }
  
  if (statusFilter !== "all") {
    filteredReminders = filteredReminders.filter(r => r.status === statusFilter);
  }

  // Sort reminders
  const sortedReminders = [...filteredReminders].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortColumn) {
      case "type":
        aValue = a.type;
        bValue = b.type;
        break;
      case "dueDate":
        aValue = new Date(a.dueDate).getTime();
        bValue = new Date(b.dueDate).getTime();
        break;
      case "registration":
        aValue = a.registration;
        bValue = b.registration;
        break;
      case "customer":
        aValue = a.customerName || "";
        bValue = b.customerName || "";
        break;
      case "motExpiry":
        aValue = a.motExpiryDate ? new Date(a.motExpiryDate).getTime() : 0;
        bValue = b.motExpiryDate ? new Date(b.motExpiryDate).getTime() : 0;
        break;
      case "daysLeft":
        const aDays = a.motExpiryDate 
          ? Math.ceil((new Date(a.motExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : 999999;
        const bDays = b.motExpiryDate 
          ? Math.ceil((new Date(b.motExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : 999999;
        aValue = aDays;
        bValue = bDays;
        break;
      case "status":
        aValue = a.status;
        bValue = b.status;
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
    if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  // Group reminders by customer
  const groupedReminders = useMemo(() => {
    const groups = new Map<string, Reminder[]>();
    
    sortedReminders.forEach(reminder => {
      const key = reminder.customerName || "Unknown Customer";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(reminder);
    });

    return Array.from(groups.entries()).map(([customerName, customerReminders]) => ({
      customerName,
      reminders: customerReminders,
    }));
  }, [sortedReminders]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Type:</label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="mot">MOT</SelectItem>
              <SelectItem value="service">Service</SelectItem>
              <SelectItem value="cambelt">Cambelt</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Status:</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="text-sm text-muted-foreground flex items-center ml-auto">
          Showing {sortedReminders.length} of {reminders.length} reminders
        </div>
      </div>

      {/* Grouped Reminders */}
      {groupedReminders.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No reminders found
        </div>
      ) : (
        <div className="space-y-6">
          {groupedReminders.map(({ customerName, reminders: customerReminders }) => (
            <Card key={customerName} className="border-2">
              <CardHeader className="pb-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    {customerName}
                    <Badge variant="secondary" className="ml-2">
                      {customerReminders.length} reminder{customerReminders.length > 1 ? 's' : ''}
                    </Badge>
                  </CardTitle>
                  {customerReminders[0]?.customerPhone && (
                    <div className="text-sm text-muted-foreground font-mono">
                      {customerReminders[0].customerPhone}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 font-semibold"
                            onClick={() => handleSort("type")}
                          >
                            Type
                            {getSortIcon("type")}
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 font-semibold"
                            onClick={() => handleSort("dueDate")}
                          >
                            Due Date
                            {getSortIcon("dueDate")}
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 font-semibold"
                            onClick={() => handleSort("registration")}
                          >
                            Registration
                            {getSortIcon("registration")}
                          </Button>
                        </TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 font-semibold"
                            onClick={() => handleSort("motExpiry")}
                          >
                            MOT Expiry
                            {getSortIcon("motExpiry")}
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 font-semibold"
                            onClick={() => handleSort("daysLeft")}
                          >
                            Days Left
                            {getSortIcon("daysLeft")}
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 font-semibold"
                            onClick={() => handleSort("status")}
                          >
                            Status
                            {getSortIcon("status")}
                          </Button>
                        </TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerReminders.map((reminder) => (
                        <ReminderRow
                          key={reminder.id}
                          reminder={reminder}
                          onEdit={onEdit}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ReminderRow({
  reminder,
  onEdit,
}: {
  reminder: Reminder;
  onEdit: (reminder: Reminder) => void;
}) {
  const utils = trpc.useUtils();
  const dueDate = new Date(reminder.dueDate);
  const formattedDate = dueDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const sendMutation = trpc.reminders.sendWhatsApp.useMutation({
    onSuccess: () => {
      toast.success("WhatsApp message sent successfully");
      utils.reminders.list.invalidate();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = trpc.reminders.delete.useMutation({
    onSuccess: () => {
      toast.success("Reminder deleted");
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

  const handleDelete = () => {
    const confirmed = confirm("Are you sure you want to delete this reminder?");
    if (confirmed) {
      deleteMutation.mutate({ id: reminder.id });
    }
  };

  // Calculate days until due
  const today = new Date();
  const diffTime = dueDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // Determine if urgent (due within 7 days)
  const isUrgent = diffDays <= 7 && diffDays >= 0 && reminder.status === "pending";

  // MOT expiry info
  let motExpiryDisplay = "-";
  let daysLeftDisplay = "-";
  let motBadge = null;

  if (reminder.motExpiryDate) {
    const motDateInfo = formatMOTDate(reminder.motExpiryDate);
    motExpiryDisplay = typeof motDateInfo === 'string' ? motDateInfo : motDateInfo.date;
    const motDate = new Date(reminder.motExpiryDate);
    const motDiffDays = Math.ceil((motDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    daysLeftDisplay = motDiffDays.toString();
    const badgeInfo = getMOTStatusBadge(motDateInfo);
    motBadge = <Badge variant={badgeInfo.variant} className={badgeInfo.className}>{badgeInfo.text}</Badge>;
  }

  return (
    <TableRow className={isUrgent ? "bg-orange-50" : ""}>
      <TableCell>
        <Badge variant={reminder.type === "MOT" ? "default" : "secondary"}>
          {reminder.type}
        </Badge>
      </TableCell>
      <TableCell className="font-medium">{formattedDate}</TableCell>
      <TableCell className="font-mono font-semibold">{reminder.registration}</TableCell>
      <TableCell className="text-sm">{reminder.customerEmail || "-"}</TableCell>
      <TableCell className="text-sm">{reminder.vehicleMake && reminder.vehicleModel ? `${reminder.vehicleMake} ${reminder.vehicleModel}` : "-"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {motExpiryDisplay}
          {motBadge}
        </div>
      </TableCell>
      <TableCell>{daysLeftDisplay}</TableCell>
      <TableCell>
        <Badge
          variant={
            reminder.status === "sent"
              ? "default"
              : reminder.status === "archived"
              ? "secondary"
              : "outline"
          }
        >
          {reminder.status}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(reminder)}
          >
            <Pencil className="w-4 h-4" />
          </Button>
          {reminder.type === "MOT" && (
            <Button
              variant="default"
              size="sm"
              onClick={handleSend}
              disabled={sendMutation.isPending || !reminder.customerPhone}
            >
              {sendMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          )}
          <Button
            variant="destructive"
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
        </div>
      </TableCell>
    </TableRow>
  );
}
