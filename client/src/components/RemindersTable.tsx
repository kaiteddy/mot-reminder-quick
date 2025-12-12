import { useState, useMemo } from "react";
import type { Reminder } from "../../../drizzle/schema";
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
import { Send, Trash2, Loader2, Pencil, ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, CheckCircle2, Clock, XCircle as XCircleIcon, Eye } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSendingBatch, setIsSendingBatch] = useState(false);

  const utils = trpc.useUtils();

  const deleteReminder = trpc.reminders.delete.useMutation({
    onSuccess: () => {
      toast.success("Reminder deleted");
      utils.reminders.list.invalidate();
      utils.reminders.generateFromVehicles.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });

  const sendWhatsApp = trpc.reminders.sendWhatsApp.useMutation({
    onSuccess: () => {
      toast.success("WhatsApp message sent");
      utils.reminders.list.invalidate();
      utils.reminders.generateFromVehicles.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to send: ${error.message}`);
    },
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const pendingIds = sortedReminders
        .filter(r => r.status === "pending" && r.customerPhone)
        .map(r => r.id);
      setSelectedIds(new Set(pendingIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBatchSend = async () => {
    const remindersToSend = sortedReminders.filter(r => selectedIds.has(r.id));
    
    if (remindersToSend.length === 0) {
      toast.error("No reminders selected");
      return;
    }

    setIsSendingBatch(true);
    let successCount = 0;
    let failCount = 0;

    for (const reminder of remindersToSend) {
      if (!reminder.customerPhone) {
        failCount++;
        continue;
      }

      try {
        await sendWhatsApp.mutateAsync({
          id: reminder.id,
          phoneNumber: reminder.customerPhone,
        });
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    setIsSendingBatch(false);
    setSelectedIds(new Set());

    if (successCount > 0) {
      toast.success(`Sent ${successCount} message${successCount !== 1 ? 's' : ''}`);
    }
    if (failCount > 0) {
      toast.error(`Failed to send ${failCount} message${failCount !== 1 ? 's' : ''}`);
    }
  };

  const getDeliveryStatusIcon = (reminder: any) => {
    if (!reminder.deliveryStatus) return null;
    
    switch (reminder.deliveryStatus) {
      case "read":
        return <span title="Read"><Eye className="w-4 h-4 text-blue-600" /></span>;
      case "delivered":
        return <span title="Delivered"><CheckCircle2 className="w-4 h-4 text-green-600" /></span>;
      case "sent":
        return <span title="Sent"><Clock className="w-4 h-4 text-yellow-600" /></span>;
      case "failed":
        return <span title="Failed"><XCircleIcon className="w-4 h-4 text-red-600" /></span>;
      default:
        return <span title="Queued"><Clock className="w-4 h-4 text-gray-400" /></span>;
    }
  };

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

  // Count reminders per customer
  const customerReminderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    reminders.forEach(r => {
      const key = r.customerName || "Unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [reminders]);

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

        <div className="flex items-center gap-4 ml-auto">
          {selectedIds.size > 0 && (
            <Button
              onClick={handleBatchSend}
              disabled={isSendingBatch}
              size="sm"
            >
              {isSendingBatch ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending {selectedIds.size}...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Selected ({selectedIds.size})
                </>
              )}
            </Button>
          )}
          <div className="text-sm text-muted-foreground">
            Showing {sortedReminders.length} of {reminders.length} reminders
          </div>
        </div>
      </div>

      {/* Reminders Table */}
      {sortedReminders.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No reminders found
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedIds.size > 0 && selectedIds.size === sortedReminders.filter(r => r.status === "pending" && r.customerPhone).length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
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
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 font-semibold"
                    onClick={() => handleSort("customer")}
                  >
                    Customer
                    {getSortIcon("customer")}
                  </Button>
                </TableHead>
                <TableHead>Contact</TableHead>
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
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedReminders.map((reminder) => {
                const customerName = reminder.customerName || "Unknown Customer";
                const hasMultipleServices = (customerReminderCounts.get(customerName) || 0) > 1;
                
                return (
                  <TableRow key={reminder.id} className={hasMultipleServices ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(reminder.id)}
                        onCheckedChange={(checked) => handleSelectOne(reminder.id, checked as boolean)}
                        disabled={reminder.status !== "pending" || !reminder.customerPhone || isSendingBatch}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={reminder.type === "MOT" ? "default" : "secondary"}>
                          {reminder.type}
                        </Badge>
                        {hasMultipleServices && (
                          <Badge variant="outline" className="text-amber-600 border-amber-600">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Multiple
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const motInfo = formatMOTDate(reminder.dueDate);
                        return typeof motInfo === 'string' ? motInfo : motInfo.date;
                      })()}
                    </TableCell>
                    <TableCell className="font-mono font-semibold text-sm">{reminder.registration}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">{customerName}</div>
                        {reminder.customerPhone && (
                          <div className="text-xs text-muted-foreground font-mono">{reminder.customerPhone}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {reminder.vehicleMake && reminder.vehicleModel
                        ? `${reminder.vehicleMake} ${reminder.vehicleModel}`
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {reminder.motExpiryDate ? (() => {
                        const motInfo = formatMOTDate(reminder.motExpiryDate);
                        const badge = getMOTStatusBadge(motInfo);
                        const displayDate = typeof motInfo === 'string' ? motInfo : motInfo.date;
                        return (
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium">{displayDate}</span>
                            <Badge variant={badge.variant} className={badge.className + " w-fit"}>
                              {badge.text}
                            </Badge>
                          </div>
                        );
                      })() : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {reminder.motExpiryDate ? (
                        <>
                          {Math.ceil(
                            (new Date(reminder.motExpiryDate).getTime() - Date.now()) /
                              (1000 * 60 * 60 * 24)
                          )}{" "}
                          days
                        </>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
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
                        {reminder.status === "sent" && getDeliveryStatusIcon(reminder)}
                        {reminder.sentAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(reminder.sentAt).toLocaleDateString('en-GB')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(reminder)}
                          disabled={deleteReminder.isPending || sendWhatsApp.isPending}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (!reminder.customerPhone) {
                              toast.error("No phone number available");
                              return;
                            }
                            sendWhatsApp.mutate({
                              id: reminder.id,
                              phoneNumber: reminder.customerPhone,
                            });
                          }}
                          disabled={
                            !reminder.customerPhone ||
                            deleteReminder.isPending ||
                            sendWhatsApp.isPending
                          }
                        >
                          {sendWhatsApp.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("Are you sure you want to delete this reminder?")) {
                              deleteReminder.mutate({ id: reminder.id });
                            }
                          }}
                          disabled={deleteReminder.isPending || sendWhatsApp.isPending}
                        >
                          {deleteReminder.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
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
    </div>
  );
}
