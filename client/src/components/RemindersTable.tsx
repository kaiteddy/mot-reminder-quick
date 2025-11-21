import { useState } from "react";
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
import { Send, Trash2, Loader2, Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatMOTDate, getMOTStatusBadge } from "@/lib/motUtils";

interface RemindersTableProps {
  reminders: Reminder[];
  onEdit: (reminder: Reminder) => void;
}

export function RemindersTable({ reminders, onEdit }: RemindersTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Registration</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead>MOT Expiry</TableHead>
            <TableHead>Days Left</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reminders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                No reminders found
              </TableCell>
            </TableRow>
          ) : (
            reminders.map((reminder) => (
              <ReminderRow
                key={reminder.id}
                reminder={reminder}
                onEdit={onEdit}
              />
            ))
          )}
        </TableBody>
      </Table>
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
    const motInfo = formatMOTDate(new Date(reminder.motExpiryDate));
    if (typeof motInfo !== 'string') {
      const expiryDate = new Date(reminder.motExpiryDate);
      motExpiryDisplay = expiryDate.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      
      const badge = getMOTStatusBadge(motInfo);
      motBadge = (
        <Badge variant={badge.variant} className={badge.className}>
          {motInfo.isExpired
            ? `Expired ${Math.abs(motInfo.daysUntilExpiry)}d ago`
            : motInfo.daysUntilExpiry === 0
            ? "Due today"
            : `${motInfo.daysUntilExpiry}d`}
        </Badge>
      );
      daysLeftDisplay = motInfo.isExpired 
        ? `-${Math.abs(motInfo.daysUntilExpiry)}`
        : `${motInfo.daysUntilExpiry}`;
    }
  }

  return (
    <TableRow className={isUrgent ? "bg-orange-50/50" : ""}>
      <TableCell>
        <Badge variant={reminder.type === "MOT" ? "default" : "secondary"}>
          {reminder.type}
        </Badge>
      </TableCell>
      <TableCell className="font-medium">{formattedDate}</TableCell>
      <TableCell className="font-mono font-semibold">{reminder.registration}</TableCell>
      <TableCell>{reminder.customerName || "-"}</TableCell>
      <TableCell className="text-sm">{reminder.customerPhone || "-"}</TableCell>
      <TableCell className="text-sm">{reminder.customerEmail || "-"}</TableCell>
      <TableCell className="text-sm">
        {reminder.vehicleMake && reminder.vehicleModel
          ? `${reminder.vehicleMake} ${reminder.vehicleModel}`
          : reminder.vehicleMake || "-"}
      </TableCell>
      <TableCell className="text-sm">{motExpiryDisplay}</TableCell>
      <TableCell>{motBadge || daysLeftDisplay}</TableCell>
      <TableCell>
        <Badge variant={reminder.status === "pending" ? "outline" : "secondary"}>
          {reminder.status}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(reminder)}
            title="Edit reminder"
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSend}
            disabled={!reminder.customerPhone || sendMutation.isPending || reminder.status === "sent"}
            title="Send WhatsApp"
          >
            {sendMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            title="Delete reminder"
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
