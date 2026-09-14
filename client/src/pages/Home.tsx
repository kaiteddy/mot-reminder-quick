import { useState, useMemo, useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  MessageSquare,
  AlertCircle,
  Trash2,
  Calendar,
  Smartphone
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MOTRefreshButtonLive } from "@/components/MOTRefreshButtonLive";
import { trpc } from "@/lib/trpc";
import { normRegKey } from "@shared/vehicleIdentity";
import { reminderBlocks, type ReminderBlock } from "@shared/reminderEligibility";
import { CALL_AFTER_DAYS, FOLLOW_UP_AFTER_DAYS, daysSince, followUpFor, followUpShownDelivery, type FollowUp, type FollowUpStage } from "@shared/motFollowUp";
import { deliveryGroup, type MessageGroup } from "@shared/messageDelivery";
import { toast } from "sonner";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { ComprehensiveVehicleTable } from "@/components/ComprehensiveVehicleTable";
import { BookMOTDialog } from "@/components/BookMOTDialog";
import { APP_TITLE } from "@/const";
import { ImageUpload } from "@/components/ImageUpload";
import { ServiceHistory } from "@/components/ServiceHistory";
import { DebouncedInput } from "@/components/DebouncedInput";

const MOT_WINDOWS: [string, string][] = [
  ["expired", "Expired"], ["due-7", "≤ 7 days"], ["due-14", "≤ 14 days"],
  ["due-30", "≤ 30 days"], ["due-60", "≤ 60 days"], ["due-90", "≤ 90 days"],
];

/** One labelled line of the filter panel: the label sits left on a wide screen, above on a phone. */
// The Message filter: the same words as the status beside each row (shared/messageDelivery.ts).
const MESSAGE_GROUPS: { key: Exclude<MessageGroup, "none">; label: string; title: string }[] = [
  { key: "read", label: "Read", title: "Opened on WhatsApp" },
  { key: "delivered", label: "Delivered", title: "On their phone, not opened yet" },
  { key: "sent", label: "Sent", title: "WhatsApp has it, but it isn't on their phone yet" },
  { key: "sms", label: "By SMS", title: "Not on WhatsApp, so it went as a text" },
  { key: "not_received", label: "Not received", title: "Didn't arrive by WhatsApp or by text" },
];

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** An on/off filter button; filled when on. */
function FilterChip({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** One figure in the summary strip above the list. */
function StatItem({ label, value, tone = "text-slate-900" }: { label: string; value: number; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={`text-lg font-semibold tabular-nums ${tone}`}>{value.toLocaleString("en-GB")}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

type SortField = "registration" | "customer" | "make" | "motExpiry" | "lastSent";
type MOTStatusFilter = "all" | "expired" | "due" | "valid";
type TaxStatusFilter = "all" | "taxed" | "untaxed" | "sorn";
type DateRangeFilter = "all" | "expired-all" | "expired-90" | "expired-60" | "expired-30" | "expired-7" | "expiring-7" | "expiring-14" | "expiring-30" | "expiring-60" | "expiring-90";

export default function Home() {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("registration");
  const [motStatusFilter, setMOTStatusFilter] = useState<MOTStatusFilter>("all");
  const [taxStatusFilter, setTaxStatusFilter] = useState<TaxStatusFilter>("all");
  const [motWindows, setMotWindows] = useState<Set<string>>(new Set());
  const toggleWindow = (key: string, on: boolean) => setMotWindows((prev) => { const next = new Set(prev); on ? next.add(key) : next.delete(key); return next; });
  const [showDeadVehicles, setShowDeadVehicles] = useState(false);
  const [hideMissingPhone, setHideMissingPhone] = useState(true);
  const [hideSorn, setHideSorn] = useState(true);
  const [hideReadAndExpired, setHideReadAndExpired] = useState(true);
  const [showOnlyNeverSent, setShowOnlyNeverSent] = useState(false);
  const [hideNoData, setHideNoData] = useState(true);
  // Cars whose reminders are switched off (no work here in 4+ years, off the road, or by hand) can't be
  // sent a reminder. On 11/09/2026 they were 93 of the 233 cars due within 30 days, padding every count.
  const [hideRemindersOff, setHideRemindersOff] = useState(true);
  // Trade accounts' cars are never reminded (Send refuses them, the four-year check skips them),
  // yet 137 of them sat in this list on 11/09/2026 with last visits back to 2015. Adam: "they
  // shouldn't be reminded".
  const [hideTrade, setHideTrade] = useState(true);
  // "Follow up" tab (shared/motFollowUp.ts): cars sent an MOT reminder whose MOT hasn't been renewed.
  // Adam, 14/09/2026: one reminder is sent "and that's it", with no follow-up for people who forgot.
  // Open it straight from a link with ?view=follow-up.
  const [view, setView] = useState<"all" | "followup">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "follow-up" ? "followup" : "all");
  const [followUpStages, setFollowUpStages] = useState<Set<FollowUpStage>>(new Set());
  const [showHandled, setShowHandled] = useState(false);
  // How long ago the reminder went, picked in plain terms: last 3 days, 2 weeks, a month, or longer.
  const [remindedWithin, setRemindedWithin] = useState<"any" | "3d" | "14d" | "31d" | "older">("any");
  // What to do next: send the follow-up message, phone them, or wait (shared/motFollowUp.ts, FollowUp.todo).
  const [todoFilter, setTodoFilter] = useState<"any" | "message" | "call" | "wait">("any");
  // Did they get it (Adam, 14/09/2026: "allow me to filter by status"). Several can be picked at once.
  const [messageGroups, setMessageGroups] = useState<Set<MessageGroup>>(new Set());
  const toggleMessageGroup = (group: MessageGroup) => setMessageGroups((prev) => {
    const next = new Set(prev);
    next.has(group) ? next.delete(group) : next.add(group);
    return next;
  });
  const toggleStage = (stage: FollowUpStage) => setFollowUpStages((prev) => {
    const next = new Set(prev);
    next.has(stage) ? next.delete(stage) : next.add(stage);
    return next;
  });
  // Which reasons a car can't be reminded (shared/reminderEligibility.ts, the same rule Send applies)
  // may still be shown on request. Any other reason, opted out or one added later, is never listed.
  const showBlocked = (block: ReminderBlock) =>
    block === "reminders_off" ? !hideRemindersOff : block === "trade" ? !hideTrade : false;
  const filtersAtDefault = !searchTerm && motWindows.size === 0 && !showDeadVehicles && hideMissingPhone && hideSorn
    && hideReadAndExpired && !showOnlyNeverSent && hideNoData && hideRemindersOff && hideTrade && messageGroups.size === 0;
  const resetFilters = () => {
    setSearchTerm("");
    setMessageGroups(new Set());
    setMotWindows(new Set());
    setShowDeadVehicles(false);
    setHideMissingPhone(true);
    setHideSorn(true);
    setHideReadAndExpired(true);
    setShowOnlyNeverSent(false);
    setHideNoData(true);
    setHideRemindersOff(true);
    setHideTrade(true);
  };
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<number>>(new Set());
  const [isSendingBatch, setIsSendingBatch] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 100;

  // History State
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVehicleForHistory, setSelectedVehicleForHistory] = useState<{ id: number, registration: string } | null>(null);

  // Preview State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [pendingVehicle, setPendingVehicle] = useState<any>(null);
  const [pendingMessageType, setPendingMessageType] = useState<"MOT" | "Service" | "UrgentFollowUp">("MOT");

  // Book MOT State
  const [isBookMOTOpen, setIsBookMOTOpen] = useState(false);
  const [selectedVehicleForMOT, setSelectedVehicleForMOT] = useState<{ id: number, registration: string, currentExpiry?: Date | string } | null>(null);

  const utils = trpc.useUtils();
  const { data: vehicles, isLoading, refetch } = trpc.database.getAllVehiclesWithCustomers.useQuery();

  const updateFollowUpMutation = trpc.reminders.updateFollowUpFlags.useMutation();

  useEffect(() => {
    updateFollowUpMutation.mutate();
    const interval = setInterval(() => {
      updateFollowUpMutation.mutate();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const bulkUpdateMutation = trpc.database.bulkUpdateMOT.useMutation({
    onSuccess: (result) => {
      toast.success(`Bulk MOT check completed!`);
      refetch();
    },
    onError: (error) => {
      toast.error(`Bulk update failed: ${error.message}`);
    },
  });

  const sendReminderMutation = trpc.reminders.sendWhatsApp.useMutation({
    onSuccess: async (data) => {
      if (data.preview && data.messageContent) {
        setPreviewContent(data.messageContent);
        setPreviewOpen(true);
        return;
      }
      toast.success("Reminder sent successfully!");
      setPreviewOpen(false);
      setPendingVehicle(null);
      await new Promise(resolve => setTimeout(resolve, 500));
      await refetch();
    },
    onError: (error) => {
      toast.error(`Failed to send reminder: ${error.message}`);
    },
  });

  const logCallMutation = trpc.reminders.logFollowUpCall.useMutation();
  const handleLogCall = async (vehicle: any) => {
    const note = window.prompt(`Log a follow-up call to ${vehicle.customerName || "the customer"} about ${vehicle.registration}.\nAnything to note? (optional)`, "");
    if (note === null) return;
    try {
      await logCallMutation.mutateAsync({ vehicleId: vehicle.id, customerId: vehicle.customerId ?? null, note: note.trim() || undefined });
      toast.success(`Call logged for ${vehicle.registration}`);
      await refetch();
    } catch (error: any) {
      toast.error(`Could not log the call: ${error?.message || error}`);
    }
  };

  const processImage = trpc.reminders.processImage.useMutation({
    onSuccess: (data) => {
      toast.success(`Extracted ${data.count} reminders`);
      refetch();
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
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      processImage.mutate({ imageData: base64 });
    };
    reader.readAsDataURL(file);
  };

  const handleBatchRefresh = async () => {
    const idsToSend = selectedVehicleIds.size === 0
      ? filteredAndSortedVehicles.map(v => v.id)
      : Array.from(selectedVehicleIds);

    if (idsToSend.length === 0) return;

    if (selectedVehicleIds.size === 0) {
      if (!confirm(`Refresh MOT & Tax for the ${idsToSend.length} visible vehicles?`)) return;
    }

    try {
      await bulkUpdateMutation.mutateAsync({ vehicleIds: idsToSend });
      setSelectedVehicleIds(new Set());
    } catch (error) { }
  };

  const confirmSend = () => {
    if (!pendingVehicle) return;

    sendReminderMutation.mutate({
      id: 0,
      phoneNumber: pendingVehicle.customerPhone,
      messageType: pendingMessageType,
      customerName: pendingVehicle.customerName || "Customer",
      registration: pendingVehicle.registration,
      expiryDate: pendingVehicle.motExpiryDate ? new Date(pendingVehicle.motExpiryDate).toISOString() : undefined,
      vehicleId: pendingVehicle.id,
      preview: false
    });
  };

  const handleSendReminder = (vehicle: any) => {
    if (!vehicle.customerPhone || !vehicle.registration) {
      toast.error("Phone number or registration missing");
      return;
    }
    setPendingVehicle(vehicle);
    const { status, daysLeft } = getMOTStatus(vehicle.motExpiryDate);
    // On the Follow up tab the message is the follow-up template, not a second copy of the reminder.
    const reminderType = view === "followup" ? "UrgentFollowUp" : status === "expired" || status === "due" ? "MOT" : "Service";
    setPendingMessageType(reminderType);

    if (view !== "followup" && status === "valid" && daysLeft && daysLeft > 60) {
      if (!window.confirm(`⚠️ Warning: MOT is not due for ${daysLeft} days. Send anyway?`)) return;
    }

    sendReminderMutation.mutate({
      id: 0,
      phoneNumber: vehicle.customerPhone,
      messageType: reminderType,
      customerName: vehicle.customerName || "Customer",
      registration: vehicle.registration,
      expiryDate: vehicle.motExpiryDate ? new Date(vehicle.motExpiryDate).toISOString() : undefined,
      vehicleId: vehicle.id,
      preview: true
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedVehicleIds(new Set(listed.filter(v => v.customerPhone).map(v => v.id)));
    } else {
      setSelectedVehicleIds(new Set());
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    const newSelected = new Set(selectedVehicleIds);
    if (checked) newSelected.add(id); else newSelected.delete(id);
    setSelectedVehicleIds(newSelected);
  };

  const handleBookMOTClick = (vehicle: any) => {
    setSelectedVehicleForMOT({ id: vehicle.id, registration: vehicle.registration, currentExpiry: vehicle.motExpiryDate });
    setIsBookMOTOpen(true);
  };

  const handleBatchSend = async () => {
    const vehiclesToSend = listed.filter(v => selectedVehicleIds.has(v.id));
    if (vehiclesToSend.length === 0) return;

    setIsSendingBatch(true);
    let successCount = 0;
    for (const vehicle of vehiclesToSend) {
      if (!vehicle.customerPhone) continue;
      try {
        const { status } = getMOTStatus(vehicle.motExpiryDate);
        const reminderType = view === "followup" ? "UrgentFollowUp" : status === "expired" || status === "due" ? "MOT" : "Service";
        await sendReminderMutation.mutateAsync({
          id: 0,
          phoneNumber: vehicle.customerPhone,
          messageType: reminderType,
          customerName: vehicle.customerName || "Customer",
          registration: vehicle.registration,
          expiryDate: vehicle.motExpiryDate ? new Date(vehicle.motExpiryDate).toISOString() : undefined,
          vehicleId: vehicle.id,
        });
        successCount++;
      } catch (error) { }
    }
    setIsSendingBatch(false);
    setSelectedVehicleIds(new Set());
    if (successCount > 0) {
      toast.success(`Sent ${successCount} reminders`);
      await new Promise(resolve => setTimeout(resolve, 500));
      await refetch();
    }
  };

  const deleteVehicleMutation = trpc.database.delete.useMutation();
  const handleDelete = async (vehicleId: number) => {
    if (!window.confirm("Are you sure?")) return;
    try {
      await deleteVehicleMutation.mutateAsync({ vehicleIds: [vehicleId] });
      toast.success("Vehicle deleted");
      await refetch();
    } catch (error) {
      toast.error("Failed to delete vehicle");
    }
  };

  const getMOTStatus = (motExpiryDate: Date | string | null): { status: MOTStatusFilter; daysLeft: number | null } => {
    if (!motExpiryDate) return { status: "expired", daysLeft: null };
    const today = new Date();
    const expiry = new Date(motExpiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { status: "expired", daysLeft: diffDays };
    if (diffDays <= 30) return { status: "due", daysLeft: diffDays };
    return { status: "valid", daysLeft: diffDays };
  };

  const filteredAndSortedVehicles = useMemo(() => {
    if (!vehicles) return [];
    let filtered = vehicles.filter(vehicle => {
      // Keep this list to cars a reminder can actually reach: the server refuses anything
      // reminderBlocks() names, so the page must never count one as due.
      if (!reminderBlocks(vehicle).every(showBlocked)) return false;

      if (!showDeadVehicles) {
        if (vehicle.motExpiryDate) {
          const expiry = new Date(vehicle.motExpiryDate);
          const today = new Date();
          const diffTime = expiry.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays < -300 && vehicle.taxStatus?.toLowerCase() !== 'taxed') return false;
        }
      }

      // Filter: Hide vehicles without phone numbers
      if (hideMissingPhone && (!vehicle.customerPhone || vehicle.customerPhone === '-')) {
        return false;
      }

      // Filter: Hide vehicles with no MOT data
      if (hideNoData && !vehicle.motExpiryDate) {
        return false;
      }

      // Filter: Hide SORN vehicles
      if (hideSorn && vehicle.taxStatus?.toLowerCase() === 'sorn') {
        return false;
      }

      // Filter: Hide expired AND read
      if (hideReadAndExpired && vehicle.motExpiryDate) {
        const diffDays = Math.ceil((new Date(vehicle.motExpiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0 && vehicle.lastReminderStatus === 'read') {
          return false;
        }
      }

      // Filter: Show only never sent
      if (showOnlyNeverSent && vehicle.lastReminderSent) {
        return false;
      }

      const termLower = searchTerm.toLowerCase();
      // Plates are stored both "GY65 FBK" and "GY65FBK": compare with spaces stripped on both sides.
      const matchesSearch = normRegKey(vehicle.registration).includes(normRegKey(searchTerm)) ||
        (vehicle.customerName?.toLowerCase() || "").includes(termLower) ||
        (vehicle.make?.toLowerCase() || "").includes(termLower);
      if (!matchesSearch) return false;

      if (motStatusFilter !== "all" && getMOTStatus(vehicle.motExpiryDate).status !== motStatusFilter) return false;
      if (taxStatusFilter !== "all") {
        const status = vehicle.taxStatus?.toLowerCase() || "untaxed";
        if (taxStatusFilter !== status) return false;
      }
      // MOT-window tick boxes: show a vehicle if its MOT falls in ANY ticked window.
      // Uses getMOTStatus so it matches the Status badge exactly (windows are cumulative ≤N days).
      if (motWindows.size > 0) {
        if (!vehicle.motExpiryDate) return false;
        const { status, daysLeft } = getMOTStatus(vehicle.motExpiryDate);
        const d = daysLeft ?? 0;
        const inAnyWindow =
          (motWindows.has("expired") && status === "expired") ||
          (status !== "expired" && (
            (motWindows.has("due-7") && d <= 7) ||
            (motWindows.has("due-14") && d <= 14) ||
            (motWindows.has("due-30") && d <= 30) ||
            (motWindows.has("due-60") && d <= 60) ||
            (motWindows.has("due-90") && d <= 90)
          ));
        if (!inAnyWindow) return false;
      }
      return true;
    });
    return filtered;
  }, [vehicles, searchTerm, motStatusFilter, taxStatusFilter, motWindows, showDeadVehicles, hideMissingPhone, hideSorn, hideReadAndExpired, showOnlyNeverSent, hideNoData, hideRemindersOff, hideTrade]);

  // Follow up tab: every car that can be reminded, was sent an MOT reminder, and hasn't renewed.
  const followUps = useMemo(() => {
    const map = new Map<number, FollowUp>();
    for (const vehicle of vehicles || []) {
      // No phone number: nobody to message or call, so nothing to follow up.
      if (reminderBlocks(vehicle).length || !vehicle.customerPhone) continue;
      const fu = followUpFor(vehicle);
      if (fu) map.set(vehicle.id, fu);
    }
    return map;
  }, [vehicles]);
  const followUpCounts = useMemo(() => {
    const counts = { open: 0, handled: 0, waiting: 0, missed: 0, expired_unchecked: 0, due: 0, message: 0, call: 0 };
    followUps.forEach((fu) => {
      if (!fu.todo) counts.handled++;
      else if (fu.todo === "wait") counts.waiting++;
      else { counts.open++; counts[fu.stage]++; counts[fu.todo]++; }
    });
    return counts;
  }, [followUps]);
  const followUpVehicles = useMemo(() => (vehicles || []).filter((vehicle) => {
    const fu = followUps.get(vehicle.id);
    if (!fu) return false;
    if (fu.handled && !showHandled) return false;
    if (followUpStages.size > 0 && !followUpStages.has(fu.stage)) return false;
    // Cars reminded too recently wait out of sight unless "Waiting" is picked.
    if (todoFilter === "any" ? fu.todo === "wait" : fu.todo !== todoFilter) return false;
    if (remindedWithin !== "any") {
      const days = daysSince(fu.remindedAt);
      if (remindedWithin === "older" ? days <= 31 : days > ({ "3d": 3, "14d": 14, "31d": 31 } as const)[remindedWithin]) return false;
    }
    const term = searchTerm.toLowerCase();
    return normRegKey(vehicle.registration).includes(normRegKey(searchTerm))
      || (vehicle.customerName?.toLowerCase() || "").includes(term)
      || (vehicle.make?.toLowerCase() || "").includes(term);
  }), [vehicles, followUps, showHandled, followUpStages, todoFilter, remindedWithin, searchTerm]);
  const unfilteredListed = view === "followup" ? followUpVehicles : filteredAndSortedVehicles;
  // The status beside each row: on Follow up the follow-up message, or the reminder if none has gone yet;
  // on All cars the last message sent. The Message filter and its counts use exactly that.
  const shownDelivery = (vehicle: (typeof unfilteredListed)[number]) => {
    if (view !== "followup") return vehicle.lastReminderDelivery ?? null;
    const fu = followUps.get(vehicle.id);
    return fu ? followUpShownDelivery(fu) : null;
  };
  const messageCounts = useMemo(() => {
    const counts: Record<MessageGroup, number> = { read: 0, delivered: 0, sent: 0, sms: 0, not_received: 0, none: 0 };
    for (const vehicle of unfilteredListed) counts[deliveryGroup(shownDelivery(vehicle))]++;
    return counts;
  }, [unfilteredListed, followUps, view]);
  const listed = useMemo(() => messageGroups.size === 0
    ? unfilteredListed
    : unfilteredListed.filter((vehicle) => messageGroups.has(deliveryGroup(shownDelivery(vehicle)))),
  [unfilteredListed, messageGroups, followUps, view]);
  const messageRow = (
    <FilterRow label="Message">
      <FilterChip active={messageGroups.size === 0} onClick={() => setMessageGroups(new Set())}>Any</FilterChip>
      {MESSAGE_GROUPS.map(({ key, label, title }) => (
        <FilterChip key={key} active={messageGroups.has(key)} onClick={() => toggleMessageGroup(key)} title={title}>
          {label} ({messageCounts[key]})
        </FilterChip>
      ))}
    </FilterRow>
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, motStatusFilter, taxStatusFilter, motWindows, hideRemindersOff, hideTrade, view, followUpStages, showHandled, todoFilter, remindedWithin, messageGroups]);

  // Keep the selection in sync with the filtered list — drop any selected vehicles that are no
  // longer in view, so "N selected" / the send count always matches what's actually on screen.
  useEffect(() => {
    setSelectedVehicleIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(listed.map((v) => v.id));
      const next = new Set<number>();
      prev.forEach((id) => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [listed]);

  const stats = useMemo(() => {
    if (!vehicles) return { total: 0, expired: 0, due: 0, valid: 0, noData: 0, expired90: 0, expired60: 0, expired30: 0, expired7: 0, expiring7: 0, expiring14: 0, expiring30: 0, expiring60: 0, expiring90: 0 };
    let expired = 0, due = 0, valid = 0, noData = 0, e90 = 0, e60 = 0, e30 = 0, e7 = 0, x7 = 0, x14 = 0, x30 = 0, x60 = 0, x90 = 0;
    const today = new Date();
    const counted = vehicles.filter((v) => reminderBlocks(v).every(showBlocked));
    counted.forEach(vehicle => {
      const { status } = getMOTStatus(vehicle.motExpiryDate);
      const lastSent = vehicle.lastReminderSent ? new Date(vehicle.lastReminderSent).getTime() : 0;
      const sentRecently = (today.getTime() - lastSent) < 30 * 24 * 60 * 60 * 1000;
      if (!vehicle.motExpiryDate) noData++;
      else {
        const diffDays = Math.ceil((new Date(vehicle.motExpiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (status === "expired" && (diffDays >= -300 || vehicle.taxStatus?.toLowerCase() === 'taxed')) {
          if (!sentRecently) { expired++; if (diffDays >= -90) e90++; if (diffDays >= -60) e60++; if (diffDays >= -30) e30++; if (diffDays >= -7) e7++; }
        } else if (status === "due" && !sentRecently) due++;
        else if (status === "valid") valid++;
        if (!sentRecently) { if (diffDays >= 0 && diffDays <= 7) x7++; if (diffDays >= 0 && diffDays <= 14) x14++; if (diffDays >= 0 && diffDays <= 30) x30++; if (diffDays >= 0 && diffDays <= 60) x60++; if (diffDays >= 0 && diffDays <= 90) x90++; }
      }
    });
    return { total: counted.length, expired, due, valid, noData, expired90: e90, expired60: e60, expired30: e30, expired7: e7, expiring7: x7, expiring14: x14, expiring30: x30, expiring60: x60, expiring90: x90 };
  }, [vehicles, hideRemindersOff, hideTrade]);

  return (
    <DashboardLayout>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">MOT Reminders</h1>
          <div className="flex flex-wrap gap-2">
            <Link href="/workshop">
              <Button variant="outline" size="sm">
                <Smartphone className="w-4 h-4 mr-1.5" /> Workshop mode
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => setShowUpload(!showUpload)}>
              <Search className="w-4 h-4 mr-1.5" /> Upload screenshot
            </Button>
            <MOTRefreshButtonLive registrations={listed.map(v => v.registration).filter(Boolean)} label="Refresh visible" size="sm" onComplete={refetch} />
          </div>
        </div>

        {showUpload && <ImageUpload onImageUpload={handleImageUpload} isProcessing={isProcessing} />}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-card px-4 py-2">
          <StatItem label="cars" value={stats.total} />
          <StatItem label="expired" value={stats.expired} tone="text-red-600" />
          <StatItem label="due soon" value={stats.due} tone="text-orange-600" />
          <StatItem label="valid" value={stats.valid} tone="text-green-700" />
          <StatItem label="no MOT date" value={stats.noData} tone="text-slate-500" />
        </div>

        <Card className="gap-0 py-0">
          <CardContent className="space-y-3 px-4 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-slate-100 p-0.5" role="tablist" aria-label="Which cars to show">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "all"}
                  onClick={() => setView("all")}
                  className={`rounded px-3 py-1 text-sm font-medium transition-colors ${view === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                >
                  All cars
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "followup"}
                  onClick={() => setView("followup")}
                  className={`inline-flex items-center rounded px-3 py-1 text-sm font-medium transition-colors ${view === "followup" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                >
                  Follow up
                  <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-xs tabular-nums text-red-700">{followUpCounts.open}</span>
                </button>
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <DebouncedInput
                  placeholder="Search registration, customer or make…"
                  value={searchTerm}
                  onChange={(val) => setSearchTerm(val)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                <span className="tabular-nums">{listed.length.toLocaleString("en-GB")} {listed.length === 1 ? "car" : "cars"}</span>
                {view === "all" && !filtersAtDefault && (
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={resetFilters}>Reset filters</Button>
                )}
              </div>
            </div>

            {view === "followup" ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Still no MOT {FOLLOW_UP_AFTER_DAYS} days after the reminder, or it has run out: send one follow-up. Still no MOT {CALL_AFTER_DAYS} days after that, or it didn't arrive: phone them.
                Checked with DVSA every morning and at midnight when the MOT runs out, so a car tested elsewhere drops off.
              </p>
              <FilterRow label="To do">
                <FilterChip active={todoFilter === "any"} onClick={() => setTodoFilter("any")}>All ({followUpCounts.open})</FilterChip>
                <FilterChip active={todoFilter === "message"} onClick={() => setTodoFilter("message")} title="Reminded, no follow-up yet: send the follow-up message">Send follow-up ({followUpCounts.message})</FilterChip>
                <FilterChip active={todoFilter === "call"} onClick={() => setTodoFilter("call")} title={`The follow-up didn't arrive, or went ${CALL_AFTER_DAYS}+ days ago and there's still no MOT: phone them`}>Call ({followUpCounts.call})</FilterChip>
                <FilterChip active={todoFilter === "wait"} onClick={() => setTodoFilter("wait")} title={`Reminded less than ${FOLLOW_UP_AFTER_DAYS} days ago and the MOT hasn't run out: giving them time to book`}>Waiting ({followUpCounts.waiting})</FilterChip>
              </FilterRow>
              <FilterRow label="Stage">
                <FilterChip active={followUpStages.size === 0} onClick={() => setFollowUpStages(new Set())}>All ({followUpCounts.open})</FilterChip>
                <FilterChip active={followUpStages.has("missed")} onClick={() => toggleStage("missed")} title="The MOT has run out, and a check since shows no new MOT">Missed MOT ({followUpCounts.missed})</FilterChip>
                <FilterChip active={followUpStages.has("expired_unchecked")} onClick={() => toggleStage("expired_unchecked")} title="The MOT has run out but the car hasn't been checked since; tonight's check will confirm it">Expired, checking ({followUpCounts.expired_unchecked})</FilterChip>
                <FilterChip active={followUpStages.has("due")} onClick={() => toggleStage("due")} title="Reminder sent, MOT runs out within 14 days, not booked">Reminded, not done ({followUpCounts.due})</FilterChip>
              </FilterRow>
              <FilterRow label="Reminded">
                <FilterChip active={remindedWithin === "any"} onClick={() => setRemindedWithin("any")}>Any time</FilterChip>
                <FilterChip active={remindedWithin === "3d"} onClick={() => setRemindedWithin("3d")}>Last 3 days</FilterChip>
                <FilterChip active={remindedWithin === "14d"} onClick={() => setRemindedWithin("14d")}>Last 2 weeks</FilterChip>
                <FilterChip active={remindedWithin === "31d"} onClick={() => setRemindedWithin("31d")}>Last month</FilterChip>
                <FilterChip active={remindedWithin === "older"} onClick={() => setRemindedWithin("older")}>Over a month ago</FilterChip>
              </FilterRow>
              {messageRow}
              <FilterRow label="Show">
                <FilterChip active={showHandled} onClick={() => setShowHandled(!showHandled)} title={`Booked in, called, or sent a follow-up that arrived less than ${CALL_AFTER_DAYS} days ago`}>Already followed up ({followUpCounts.handled})</FilterChip>
              </FilterRow>
            </div>
            ) : (
            <div className="space-y-2 border-t pt-3">
              <FilterRow label="MOT due">
                <FilterChip active={motWindows.size === 0} onClick={() => setMotWindows(new Set())}>Any</FilterChip>
                {MOT_WINDOWS.map(([key, label]) => (
                  <FilterChip key={key} active={motWindows.has(key)} onClick={() => toggleWindow(key, !motWindows.has(key))}>{label}</FilterChip>
                ))}
              </FilterRow>
              {messageRow}
              <FilterRow label="Hide">
                <FilterChip active={hideMissingPhone} onClick={() => setHideMissingPhone(!hideMissingPhone)} title="Customers with no mobile number, who can't be sent a reminder">No phone</FilterChip>
                <FilterChip active={hideSorn} onClick={() => setHideSorn(!hideSorn)} title="Declared off the road with DVLA">SORN</FilterChip>
                <FilterChip active={hideReadAndExpired} onClick={() => setHideReadAndExpired(!hideReadAndExpired)} title="MOT expired and the last reminder was read">Read &amp; expired</FilterChip>
                <FilterChip active={hideNoData} onClick={() => setHideNoData(!hideNoData)} title="No MOT date on file">No MOT date</FilterChip>
                <FilterChip active={hideRemindersOff} onClick={() => setHideRemindersOff(!hideRemindersOff)} title="Reminders switched off: no work here in 4+ years, off the road, or by hand">Reminders off</FilterChip>
                <FilterChip active={hideTrade} onClick={() => setHideTrade(!hideTrade)} title="Cars on trade accounts (marked on the customer page), which are never sent reminders">Trade</FilterChip>
              </FilterRow>
              <FilterRow label="Show">
                <FilterChip active={showDeadVehicles} onClick={() => setShowDeadVehicles(!showDeadVehicles)} title="MOT ran out over 300 days ago and not taxed">Dead cars</FilterChip>
                <FilterChip active={showOnlyNeverSent} onClick={() => setShowOnlyNeverSent(!showOnlyNeverSent)} title="Only cars never sent a reminder">Never sent only</FilterChip>
              </FilterRow>
            </div>
            )}
          </CardContent>
        </Card>

        {selectedVehicleIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5">
            <span className="text-sm font-semibold text-primary">{selectedVehicleIds.size} selected</span>
            <Button size="sm" onClick={handleBatchSend} disabled={isSendingBatch} className="ml-auto">
              {isSendingBatch ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {view === "followup" ? "Send follow-up" : "Send MOT Reminders"} ({selectedVehicleIds.size})
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedVehicleIds(new Set())} disabled={isSendingBatch}>Clear</Button>
          </div>
        )}

        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="p-0">
            <ComprehensiveVehicleTable
              key={view}
              followUps={view === "followup" ? followUps : undefined}
              onLogCall={view === "followup" ? handleLogCall : undefined}
              defaultSort={view === "followup" ? { field: "daysLeft", direction: "asc" } : undefined}
              vehicles={listed.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)}
              isLoading={isLoading}
              selectedVehicleIds={selectedVehicleIds}
              onSelectAll={handleSelectAll}
              onSelectOne={handleSelectOne}
              onSendReminder={handleSendReminder}
              onBookMOT={handleBookMOTClick}
              onDelete={handleDelete}
              isSendingBatch={isSendingBatch}
              isDeletingBatch={deleteVehicleMutation.isPending}
              pendingVehicleId={pendingVehicle?.id}
              onViewHistory={(vehicle) => {
                setSelectedVehicleForHistory({ id: vehicle.id, registration: vehicle.registration });
                setHistoryOpen(true);
              }}
            />
          </CardContent>

          {/* Pagination Controls */}
          {!isLoading && listed.length > 0 && (
            <div className="flex items-center justify-between border-t px-3 py-1.5">
              <div className="text-xs text-slate-500 tabular-nums">
                {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, listed.length)} of {listed.length.toLocaleString("en-GB")}
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage * ITEMS_PER_PAGE >= listed.length}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Dialogs */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Preview Message</DialogTitle>
              <DialogDescription className="sr-only">Preview of the message content that will be sent to the customer.</DialogDescription>
            </DialogHeader>
            <div className="p-4 bg-slate-50 rounded-lg whitespace-pre-wrap">{previewContent}</div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancel</Button>
              <Button onClick={confirmSend}>Confirm & Send</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {selectedVehicleForMOT && (
          <BookMOTDialog open={isBookMOTOpen} onOpenChange={setIsBookMOTOpen} vehicleId={selectedVehicleForMOT.id} registration={selectedVehicleForMOT.registration} currentExpiryDate={selectedVehicleForMOT.currentExpiry} onSuccess={() => refetch()}
          />
        )}

        {/* Service History Dialog */}
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Service History: {selectedVehicleForHistory?.registration}</DialogTitle>
              <DialogDescription className="sr-only">Historical service and document logs for this vehicle.</DialogDescription>
            </DialogHeader>
            {selectedVehicleForHistory && (
              <ServiceHistory vehicleId={selectedVehicleForHistory.id} />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
