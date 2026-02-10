import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  Database as DatabaseIcon,
  Search,
  RefreshCw,
  ArrowUpDown,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Clock,
  Eye,
  ChevronUp,
  ChevronDown,
  MessageSquare,
  AlertCircle,
  Trash2
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea"; // Assuming we want to show it in a readonly textarea or just a div
import { MOTRefreshButtonLive } from "@/components/MOTRefreshButtonLive";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { ComprehensiveVehicleTable } from "@/components/ComprehensiveVehicleTable";
import { BookMOTDialog } from "@/components/BookMOTDialog";
import { ServiceHistory } from "@/components/ServiceHistory";

type SortField = "registration" | "customer" | "make" | "motExpiry" | "lastSent";
type SortDirection = "asc" | "desc";
type MOTStatusFilter = "all" | "expired" | "due" | "valid";
type TaxStatusFilter = "all" | "taxed" | "untaxed" | "sorn";
type DateRangeFilter = "all" | "expired-all" | "expired-90" | "expired-60" | "expired-30" | "expired-7" | "expiring-7" | "expiring-14" | "expiring-30" | "expiring-60" | "expiring-90";

export default function Database() {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("registration");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [motStatusFilter, setMOTStatusFilter] = useState<MOTStatusFilter>("all");
  const [taxStatusFilter, setTaxStatusFilter] = useState<TaxStatusFilter>("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
  const [showDeadVehicles, setShowDeadVehicles] = useState(false);
  const [hideMissingPhone, setHideMissingPhone] = useState(true);
  const [hideSorn, setHideSorn] = useState(true);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<number>>(new Set());
  const [isSendingBatch, setIsSendingBatch] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  // Preview State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [pendingVehicle, setPendingVehicle] = useState<any>(null);

  // Book MOT State
  const [isBookMOTOpen, setIsBookMOTOpen] = useState(false);
  const [selectedVehicleForMOT, setSelectedVehicleForMOT] = useState<{ id: number, registration: string, currentExpiry?: Date | string } | null>(null);

  // Delete Confirmation State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"single" | "batch">("single");
  const [vehicleIdToDelete, setVehicleIdToDelete] = useState<number | null>(null);

  // Service History State
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVehicleForHistory, setSelectedVehicleForHistory] = useState<{ id: number, registration: string } | null>(null);

  // Generic Confirmation State
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
    actionLabel?: string;
    actionVariant?: "default" | "destructive";
  } | null>(null);

  const { data: vehicles, isLoading, refetch } = trpc.database.getAllVehiclesWithCustomers.useQuery();

  const bulkUpdateMutation = trpc.database.bulkUpdateMOT.useMutation({
    onSuccess: (result) => {
      toast.success(`Bulk MOT check completed! Updated: ${result.updated}, Failed: ${result.failed}, Skipped: ${result.skipped}`);
      if (result.errors.length > 0) {
        toast.error(`Errors: ${result.errors.join(", ")}`);
      }
      refetch();
    },
    onError: (error) => {
      toast.error(`Bulk update failed: ${error.message}`);
    },
  });

  const sendReminderMutation = trpc.reminders.sendWhatsApp.useMutation({
    onSuccess: async (data) => {
      // If preview, show dialog
      if (data.preview && data.messageContent) {
        setPreviewContent(data.messageContent);
        setPreviewOpen(true);
        return;
      }

      toast.success("Reminder sent successfully!");
      setPreviewOpen(false);
      setPreviewContent("");
      setPendingVehicle(null);

      // Small delay to ensure database transaction commits
      await new Promise(resolve => setTimeout(resolve, 500));
      // Refresh vehicle data to show updated last sent date and delivery status
      await refetch();
    },
    onError: (error) => {
      toast.error(`Failed to send reminder: ${error.message}`);
    },
  });

  const handleBatchRefresh = async () => {
    const isFullRefresh = selectedVehicleIds.size === 0;

    // Get visible vehicles if implicit selection
    const visibleVehicles = filteredAndSortedVehicles.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    // Calculate which IDs to send
    const idsToSend = isFullRefresh
      ? visibleVehicles.map(v => v.id)
      : Array.from(selectedVehicleIds);

    if (idsToSend.length === 0) return;

    // For implicitly selected view refresh, show confirmation
    if (isFullRefresh) {
      setConfirmConfig({
        title: "Refresh MOT & Tax?",
        description: `Refresh MOT & Tax for the ${idsToSend.length} visible vehicles? This will perform lookups for all ${idsToSend.length} vehicles.`,
        onConfirm: async () => {
          try {
            await bulkUpdateMutation.mutateAsync({
              vehicleIds: idsToSend,
            });
            setSelectedVehicleIds(new Set());
          } catch (error) {
            console.error("Batch refresh failed:", error);
          }
        },
        actionLabel: "Refresh",
        actionVariant: "default"
      });
      setConfirmOpen(true);
      return;
    }

    try {
      await bulkUpdateMutation.mutateAsync({
        vehicleIds: idsToSend,
      });
      setSelectedVehicleIds(new Set());
    } catch (error) {
      console.error("Batch refresh failed:", error);
    }
  };

  const confirmSend = () => {
    if (!pendingVehicle) return;

    // Determine reminder type based on MOT status
    const { status } = getMOTStatus(pendingVehicle.motExpiryDate);
    const reminderType = status === "expired" || status === "due" ? "MOT" : "Service";

    sendReminderMutation.mutate({
      id: 0,
      phoneNumber: pendingVehicle.customerPhone,
      messageType: reminderType,
      customerName: pendingVehicle.customerName || "Customer",
      registration: pendingVehicle.registration,
      expiryDate: pendingVehicle.motExpiryDate ? new Date(pendingVehicle.motExpiryDate).toISOString() : undefined,
      vehicleId: pendingVehicle.id,
      customerId: pendingVehicle.customerId ?? undefined,
      preview: false // Actually send
    });
  };

  const handleSendReminder = (vehicle: any) => {
    if (!vehicle.customerPhone) {
      toast.error("No phone number available for this customer");
      return;
    }
    if (!vehicle.registration) {
      toast.error("No vehicle registration available");
      return;
    }

    // Set pending vehicle
    setPendingVehicle(vehicle);

    // Determine reminder type based on MOT status
    const { status, daysLeft } = getMOTStatus(vehicle.motExpiryDate);
    const reminderType = status === "expired" || status === "due" ? "MOT" : "Service";

    // Warn if sending too early (e.g. > 60 days)
    if (status === "valid" && daysLeft && daysLeft > 60) {
      setConfirmConfig({
        title: "Send Reminder Early?",
        description: `⚠️ Warning: This vehicle's MOT is not due for ${daysLeft} days. The "MOT Reminder" message will ask the customer to "Book your MOT test today". Are you sure you want to send this message now?`,
        onConfirm: () => confirmSend(),
        actionLabel: "Send Anyway",
        actionVariant: "default"
      });
      setConfirmOpen(true);
      return;
    }

    // Request preview first
    sendReminderMutation.mutate({
      id: 0,
      phoneNumber: vehicle.customerPhone,
      messageType: reminderType,
      customerName: vehicle.customerName || "Customer",
      registration: vehicle.registration,
      expiryDate: vehicle.motExpiryDate ? new Date(vehicle.motExpiryDate).toISOString() : undefined,
      vehicleId: vehicle.id,
      customerId: vehicle.customerId ?? undefined,
      preview: true // Request preview
    });
  };

  const handleBulkUpdate = () => {
    if (!vehicles || vehicles.length === 0) {
      toast.error("No vehicles to update");
      return;
    }

    toast.info(`Starting bulk MOT check for ${vehicles.length} vehicles...`);
    bulkUpdateMutation.mutate({});
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const vehiclesWithPhone = filteredAndSortedVehicles
        .filter(v => v.customerPhone)
        .map(v => v.id);
      setSelectedVehicleIds(new Set(vehiclesWithPhone));
    } else {
      setSelectedVehicleIds(new Set());
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    const newSelected = new Set(selectedVehicleIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedVehicleIds(newSelected);
  };

  const handleBookMOTClick = (vehicle: any) => {
    setSelectedVehicleForMOT({
      id: vehicle.id,
      registration: vehicle.registration,
      currentExpiry: vehicle.motExpiryDate
    });
    setIsBookMOTOpen(true);
  };



  const handleBatchSend = async () => {
    const vehiclesToSend = filteredAndSortedVehicles.filter(v => selectedVehicleIds.has(v.id));

    if (vehiclesToSend.length === 0) {
      toast.error("No vehicles selected");
      return;
    }

    setIsSendingBatch(true);
    let successCount = 0;
    let failCount = 0;

    for (const vehicle of vehiclesToSend) {
      if (!vehicle.customerPhone) {
        failCount++;
        continue;
      }

      try {
        const { status } = getMOTStatus(vehicle.motExpiryDate);
        const reminderType = status === "expired" || status === "due" ? "MOT" : "Service";

        await sendReminderMutation.mutateAsync({
          id: 0,
          phoneNumber: vehicle.customerPhone,
          messageType: reminderType,
          customerName: vehicle.customerName || "Customer",
          registration: vehicle.registration,
          expiryDate: vehicle.motExpiryDate ? new Date(vehicle.motExpiryDate).toISOString() : undefined,
          vehicleId: vehicle.id, // Link to vehicle for status tracking
          customerId: vehicle.customerId ?? undefined, // Link to customer for status tracking
        });
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    setIsSendingBatch(false);
    setSelectedVehicleIds(new Set());

    if (successCount > 0) {
      toast.success(`Sent ${successCount} reminder${successCount !== 1 ? 's' : ''}`);
      // Small delay to ensure all database transactions commit
      await new Promise(resolve => setTimeout(resolve, 500));
      // Refresh vehicle data to show updated status
      await refetch();
    }
    if (failCount > 0) {
      toast.error(`Failed to send ${failCount} reminder${failCount !== 1 ? 's' : ''}`);
    }
  };

  const deleteVehicleMutation = trpc.database.delete.useMutation();

  const handleDelete = (vehicleId: number) => {
    setVehicleIdToDelete(vehicleId);
    setDeleteMode("single");
    setDeleteConfirmOpen(true);
  };

  const handleBatchDelete = () => {
    if (selectedVehicleIds.size === 0) return;
    setDeleteMode("batch");
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    try {
      if (deleteMode === "single" && vehicleIdToDelete) {
        await deleteVehicleMutation.mutateAsync({ vehicleIds: [vehicleIdToDelete] });
        toast.success("Vehicle deleted");
      } else if (deleteMode === "batch") {
        await deleteVehicleMutation.mutateAsync({ vehicleIds: Array.from(selectedVehicleIds) });
        toast.success(`Deleted ${selectedVehicleIds.size} vehicles`);
        setSelectedVehicleIds(new Set());
      }
      await refetch();
    } catch (error) {
      toast.error("Failed to delete");
    } finally {
      setDeleteConfirmOpen(false);
      setVehicleIdToDelete(null);
    }
  };

  const getDeliveryStatusIcon = (status: string | null | undefined) => {
    if (!status) return null;

    switch (status) {
      case "read":
        return <span title="Read"><Eye className="w-4 h-4 text-blue-600" /></span>;
      case "delivered":
        return <span title="Delivered"><CheckCircle2 className="w-4 h-4 text-green-600" /></span>;
      case "sent":
        return <span title="Sent"><Clock className="w-4 h-4 text-yellow-600" /></span>;
      case "failed":
        return <span title="Failed"><XCircle className="w-4 h-4 text-red-600" /></span>;
      default:
        // For queued or other states
        return <span title="Queued"><Clock className="w-4 h-4 text-gray-400" /></span>;
    }
  };

  const getMOTStatus = (motExpiryDate: Date | null): { status: MOTStatusFilter; daysLeft: number | null } => {
    if (!motExpiryDate) return { status: "expired", daysLeft: null };

    const today = new Date();
    const expiry = new Date(motExpiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { status: "expired", daysLeft: diffDays };
    if (diffDays <= 30) return { status: "due", daysLeft: diffDays };
    return { status: "valid", daysLeft: diffDays };
  };

  const getMOTStatusBadge = (status: MOTStatusFilter, daysLeft: number | null) => {
    if (!daysLeft && daysLeft !== 0) {
      return <Badge variant="secondary">No MOT Data</Badge>;
    }

    switch (status) {
      case "expired":
        return <Badge variant="destructive" className="bg-red-500">Expired {Math.abs(daysLeft)}d ago</Badge>;
      case "due":
        return <Badge variant="default" className="bg-orange-500">Due in {daysLeft}d</Badge>;
      case "valid":
        return <Badge variant="default" className="bg-green-500">{daysLeft}d left</Badge>;
      default:
        return null;
    }
  };

  const filteredAndSortedVehicles = useMemo(() => {
    if (!vehicles) return [];

    let filtered = vehicles.filter(vehicle => {
      // Filter: Dead Vehicles (Hide by default if unchecked)
      if (!showDeadVehicles) {
        if (vehicle.motExpiryDate) {
          const expiry = new Date(vehicle.motExpiryDate);
          const today = new Date();
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(today.getFullYear() - 1);

          const diffTime = expiry.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          // Using 300 days (approx 10 months) to catch vehicles approaching the 1-year mark
          // or where the user perception of "one year" is looser.
          if (diffDays < -300) {
            // MOT Expired > 10 months
            // Dead if Tax is NOT 'Taxed' (i.e. Untaxed, SORN, or Unknown)
            // This is safer than checking tax dates which might be < 1 year but irrelevant if SORN.
            const isTaxed = vehicle.taxStatus?.toLowerCase() === 'taxed';

            if (!isTaxed) {
              return false;
            }
          }
        }
      }

      // Filter: Hide vehicles without phone numbers
      if (hideMissingPhone && (!vehicle.customerPhone || vehicle.customerPhone === '-')) {
        return false;
      }

      // Filter: Hide SORN vehicles
      if (hideSorn && vehicle.taxStatus?.toLowerCase() === 'sorn') {
        return false;
      }

      const termLower = searchTerm.toLowerCase();
      const termNormalized = termLower.replace(/\s+/g, '');

      const matchesSearch =
        (vehicle.registration?.toLowerCase().replace(/\s+/g, '') || "").includes(termNormalized) ||
        vehicle.customerName?.toLowerCase().includes(termLower) ||
        vehicle.make?.toLowerCase().includes(termLower) ||
        vehicle.model?.toLowerCase().includes(termLower);

      if (!matchesSearch) return false;

      if (motStatusFilter !== "all") {
        const { status } = getMOTStatus(vehicle.motExpiryDate);
        if (status !== motStatusFilter) return false;
      }

      // Tax Filter
      if (taxStatusFilter !== "all") {
        const currentStatus = vehicle.taxStatus?.toLowerCase() || "untaxed"; // Default to untaxed if unknown
        if (taxStatusFilter === "taxed" && currentStatus !== "taxed") return false;
        if (taxStatusFilter === "untaxed" && currentStatus !== "untaxed") return false;
        if (taxStatusFilter === "sorn" && currentStatus !== "sorn") return false;
      }

      // Date range filter
      if (dateRangeFilter !== "all") {
        if (!vehicle.motExpiryDate) return false;

        const today = new Date();
        // Exclude if sent recently (last 30 days)
        const lastSent = vehicle.lastReminderSent ? new Date(vehicle.lastReminderSent).getTime() : 0;
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        if ((today.getTime() - lastSent) < THIRTY_DAYS_MS) {
          return false;
        }

        const expiry = new Date(vehicle.motExpiryDate);
        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        switch (dateRangeFilter) {
          case "expired-all":
            if (diffDays >= 0) return false;
            break;
          case "expired-90":
            if (diffDays >= 0 || diffDays < -90) return false;
            break;
          case "expired-60":
            if (diffDays >= 0 || diffDays < -60) return false;
            break;
          case "expired-30":
            if (diffDays >= 0 || diffDays < -30) return false;
            break;
          case "expired-7":
            if (diffDays >= 0 || diffDays < -7) return false;
            break;
          case "expiring-7":
            if (diffDays < 0 || diffDays > 7) return false;
            break;
          case "expiring-14":
            if (diffDays < 0 || diffDays > 14) return false;
            break;
          case "expiring-30":
            if (diffDays < 0 || diffDays > 30) return false;
            break;
          case "expiring-60":
            if (diffDays < 0 || diffDays > 60) return false;
            break;
          case "expiring-90":
            if (diffDays < 0 || diffDays > 90) return false;
            break;
        }
      }

      return true;
    });

    filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortField) {
        case "registration":
          aVal = a.registration || "";
          bVal = b.registration || "";
          break;
        case "customer":
          aVal = a.customerName || "";
          bVal = b.customerName || "";
          break;
        case "make":
          aVal = `${a.make || ""} ${a.model || ""}`;
          bVal = `${b.make || ""} ${b.model || ""}`;
          break;
        case "motExpiry":
          aVal = a.motExpiryDate ? new Date(a.motExpiryDate).getTime() : 0;
          bVal = b.motExpiryDate ? new Date(b.motExpiryDate).getTime() : 0;
          break;
        case "lastSent":
          // Handle null values - push never-sent to end
          aVal = a.lastReminderSent ? new Date(a.lastReminderSent).getTime() : 0;
          bVal = b.lastReminderSent ? new Date(b.lastReminderSent).getTime() : 0;
          break;
      }

      if (sortDirection === "asc") {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    return filtered;
  }, [vehicles, searchTerm, sortField, sortDirection, motStatusFilter, dateRangeFilter]);

  // Reset to page 1 when filters change
  useMemo(() => {
    setCurrentPage(1);
  }, [searchTerm, motStatusFilter, dateRangeFilter]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const stats = useMemo(() => {
    if (!vehicles) return {
      total: 0, expired: 0, due: 0, valid: 0, noData: 0,
      expired90: 0, expired60: 0, expired30: 0, expired7: 0,
      expiring7: 0, expiring14: 0, expiring30: 0, expiring60: 0, expiring90: 0
    };

    let expired = 0;
    let due = 0;
    let valid = 0;
    let noData = 0;
    let expired90 = 0, expired60 = 0, expired30 = 0, expired7 = 0;
    let expiring7 = 0, expiring14 = 0, expiring30 = 0, expiring60 = 0, expiring90 = 0;

    const today = new Date();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    vehicles.forEach(vehicle => {
      // Check if sent recently (within last 30 days)
      const lastSent = vehicle.lastReminderSent ? new Date(vehicle.lastReminderSent).getTime() : 0;
      const sentRecently = (today.getTime() - lastSent) < THIRTY_DAYS_MS;

      // If sent recently, don't count towards "actionable" stats (Expired/Due)
      // We still include them in Total and No Data if applicable, or maybe just exclude from the "To Do" buckets

      const { status } = getMOTStatus(vehicle.motExpiryDate);
      if (!vehicle.motExpiryDate) {
        noData++;
      } else {
        const expiry = new Date(vehicle.motExpiryDate);
        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (status === "expired") {
          // Check for Dead Vehicle logic
          const isTaxed = vehicle.taxStatus?.toLowerCase() === 'taxed';
          // Dead if MOT expired > 1 year AND (Tax != Taxed) matched the filter logic
          // Note: diffDays is negative for expired.
          if (diffDays < -300 && !isTaxed) {
            // It is dead. Do not count as "Actionable Expired" unless we want a separate "Dead" stat.
            // For now, simpler to just exclude it from "Expired" so the count matches the simplified view.
          } else {
            // Only count as "Expired" (actionable) if NOT sent recently
            if (!sentRecently) {
              expired++;
              if (diffDays >= -90) expired90++;
              if (diffDays >= -60) expired60++;
              if (diffDays >= -30) expired30++;
              if (diffDays >= -7) expired7++;
            }
          }
        } else if (status === "due") {
          // Only count as "Due" if NOT sent recently
          if (!sentRecently) {
            due++;
          }
        } else {
          valid++;
        }

        // Count expiring vehicles (only if not sent recently)
        if (!sentRecently) {
          if (diffDays >= 0 && diffDays <= 7) expiring7++;
          if (diffDays >= 0 && diffDays <= 14) expiring14++;
          if (diffDays >= 0 && diffDays <= 30) expiring30++;
          if (diffDays >= 0 && diffDays <= 60) expiring60++;
          if (diffDays >= 0 && diffDays <= 90) expiring90++;
        }
      }
    });

    return {
      total: vehicles.length, expired, due, valid, noData,
      expired90, expired60, expired30, expired7,
      expiring7, expiring14, expiring30, expiring60, expiring90
    };
  }, [vehicles]);

  const missingPhoneCount = useMemo(() => {
    if (!vehicles) return 0;
    return vehicles.filter(v => !v.customerPhone || v.customerPhone === '-').length;
  }, [vehicles]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <DatabaseIcon className="w-8 h-8" />
              Database Overview
            </h1>
            <p className="text-slate-600 mt-1">Complete view of all vehicles, customers, and MOT status</p>
          </div>
          <div className="flex gap-2">
            {missingPhoneCount > 0 && (
              <Button variant="outline" asChild className="border-red-200 text-red-600 hover:bg-red-50">
                <Link href="/diagnose-mot">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Clean up {missingPhoneCount} Missing Contact
                  </span>
                </Link>
              </Button>
            )}
            {stats.noData > 0 && (
              <Button variant="outline" asChild>
                <Link href="/diagnose-mot">
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Diagnose {stats.noData} Missing MOT
                </Link>
              </Button>
            )}
            <MOTRefreshButtonLive
              registrations={filteredAndSortedVehicles.map(v => v.registration).filter(Boolean)}
              label="Refresh Visible"
              variant="default"
              onComplete={refetch}
            />
            <MOTRefreshButtonLive
              registrations={vehicles?.map(v => v.registration).filter(Boolean) || []}
              label="Bulk MOT Check (All)"
              variant="outline"
              onComplete={refetch}
            />
            {selectedVehicleIds.size > 0 && (
              <Button
                onClick={handleBatchSend}
                disabled={isSendingBatch}
                variant="default"
              >
                {isSendingBatch ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending {selectedVehicleIds.size}...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send Selected ({selectedVehicleIds.size})
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total Vehicles</CardDescription>
              <CardTitle className="text-3xl">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-red-200 bg-red-50">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-1">
                <XCircle className="w-4 h-4 text-red-600" />
                Expired
              </CardDescription>
              <CardTitle className="text-3xl text-red-600">{stats.expired}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-orange-200 bg-orange-50">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-1">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                Due Soon
              </CardDescription>
              <CardTitle className="text-3xl text-orange-600">{stats.due}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Valid
              </CardDescription>
              <CardTitle className="text-3xl text-green-600">{stats.valid}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-slate-200 bg-slate-50">
            <CardHeader className="pb-3">
              <CardDescription>No MOT Data</CardDescription>
              <CardTitle className="text-3xl text-slate-600">{stats.noData}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-red-100 bg-red-50/30">
            <CardHeader className="pb-3">
              <CardDescription>Missing Phone</CardDescription>
              <CardTitle className="text-3xl text-red-500">{missingPhoneCount}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Date Range Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filter by Date Range</CardTitle>
            <CardDescription>Click a category to filter vehicles by MOT expiry timeframe</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Expired Categories */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Expired</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Button
                    variant={dateRangeFilter === "expired-all" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expired-all" ? "all" : "expired-all")}
                    className="justify-between"
                  >
                    <span>All Expired</span>
                    <Badge variant="secondary" className="ml-2">{stats.expired}</Badge>
                  </Button>
                  <Button
                    variant={dateRangeFilter === "expired-60" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expired-60" ? "all" : "expired-60")}
                    className="justify-between"
                  >
                    <span>Last 60 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expired60}</Badge>
                  </Button>
                  <Button
                    variant={dateRangeFilter === "expired-30" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expired-30" ? "all" : "expired-30")}
                    className="justify-between"
                  >
                    <span>Last 30 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expired30}</Badge>
                  </Button>
                  <Button
                    variant={dateRangeFilter === "expired-7" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expired-7" ? "all" : "expired-7")}
                    className="justify-between"
                  >
                    <span>Last 7 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expired7}</Badge>
                  </Button>
                </div>
              </div>

              {/* Expiring Categories */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Expiring Soon</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <Button
                    variant={dateRangeFilter === "expiring-7" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expiring-7" ? "all" : "expiring-7")}
                    className="justify-between"
                  >
                    <span>Next 7 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expiring7}</Badge>
                  </Button>
                  <Button
                    variant={dateRangeFilter === "expiring-14" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expiring-14" ? "all" : "expiring-14")}
                    className="justify-between"
                  >
                    <span>Next 14 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expiring14}</Badge>
                  </Button>
                  <Button
                    variant={dateRangeFilter === "expiring-30" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expiring-30" ? "all" : "expiring-30")}
                    className="justify-between"
                  >
                    <span>Next 30 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expiring30}</Badge>
                  </Button>
                  <Button
                    variant={dateRangeFilter === "expiring-60" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expiring-60" ? "all" : "expiring-60")}
                    className="justify-between"
                  >
                    <span>Next 60 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expiring60}</Badge>
                  </Button>
                  <Button
                    variant={dateRangeFilter === "expiring-90" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expiring-90" ? "all" : "expiring-90")}
                    className="justify-between"
                  >
                    <span>Next 90 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expiring90}</Badge>
                  </Button>
                </div>
              </div>

              {dateRangeFilter !== "all" && (
                <Button
                  variant="ghost"
                  onClick={() => setDateRangeFilter("all")}
                  className="w-full"
                >
                  Clear Date Filter
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Search & Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search by registration, customer, make, or model..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={motStatusFilter} onValueChange={(value) => setMOTStatusFilter(value as MOTStatusFilter)}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="MOT Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="due">Due Soon (≤30d)</SelectItem>
                  <SelectItem value="valid">Valid (&gt;30d)</SelectItem>
                </SelectContent>
              </Select>

              <Select value={taxStatusFilter} onValueChange={(value) => setTaxStatusFilter(value as TaxStatusFilter)}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Tax Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tax Status</SelectItem>
                  <SelectItem value="taxed">Taxed</SelectItem>
                  <SelectItem value="untaxed">Untaxed</SelectItem>
                  <SelectItem value="sorn">SORN</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2 mt-4">
              <Checkbox
                id="show-dead"
                checked={showDeadVehicles}
                onCheckedChange={(checked) => setShowDeadVehicles(checked as boolean)}
              />
              <label
                htmlFor="show-dead"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Show Dead Vehicles (Expired &gt; 1yr & Untaxed)
              </label>
            </div>

            <div className="flex items-center space-x-2 mt-2">
              <Checkbox
                id="hide-no-phone"
                checked={hideMissingPhone}
                onCheckedChange={(checked) => setHideMissingPhone(checked as boolean)}
              />
              <label
                htmlFor="hide-no-phone"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Hide Vehicles without Phone Number
              </label>
            </div>

            <div className="flex items-center space-x-2 mt-2">
              <Checkbox
                id="hide-sorn"
                checked={hideSorn}
                onCheckedChange={(checked) => setHideSorn(checked as boolean)}
              />
              <label
                htmlFor="hide-sorn"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Hide SORN Vehicles
              </label>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-slate-600">
                Showing {filteredAndSortedVehicles.length} of {stats.total} vehicles
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <Button
                onClick={handleBatchRefresh}
                disabled={bulkUpdateMutation.isPending || isSendingBatch}
                variant={selectedVehicleIds.size === 0 ? "outline" : "secondary"}
                size="sm"
                className="animate-in fade-in"
              >
                {bulkUpdateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {selectedVehicleIds.size === 0 ? "Refreshing View..." : "Refreshing..."}
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {selectedVehicleIds.size === 0 ? "Refresh View" : "Refresh Selected"}
                  </>
                )}
              </Button>

              {selectedVehicleIds.size > 0 && (
                <Button
                  onClick={handleBatchSend}
                  disabled={isSendingBatch}
                  size="sm"
                  className="animate-in fade-in slide-in-from-bottom-2"
                >
                  {isSendingBatch ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending {selectedVehicleIds.size}...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send Selected ({selectedVehicleIds.size})
                    </>
                  )}
                </Button>
              )}
            </div>
            {selectedVehicleIds.size > 0 && (
              <Button
                onClick={handleBatchDelete}
                disabled={deleteVehicleMutation.isPending}
                size="sm"
                variant="destructive"
                className="ml-2 animate-in fade-in slide-in-from-bottom-2"
              >
                {deleteVehicleMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Selected ({selectedVehicleIds.size})
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <ComprehensiveVehicleTable
              vehicles={filteredAndSortedVehicles.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)}
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
          {!isLoading && filteredAndSortedVehicles.length > 0 && (
            <div className="flex items-center justify-between px-4 py-4 border-t">
              <div className="text-sm text-slate-500">
                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredAndSortedVehicles.length)} of {filteredAndSortedVehicles.length} entries
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <div className="flex items-center gap-1 px-2">
                  <span className="text-sm font-medium">Page {currentPage} of {Math.ceil(filteredAndSortedVehicles.length / ITEMS_PER_PAGE)}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredAndSortedVehicles.length / ITEMS_PER_PAGE), p + 1))}
                  disabled={currentPage >= Math.ceil(filteredAndSortedVehicles.length / ITEMS_PER_PAGE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Preview Message</DialogTitle>
              <DialogDescription>
                Check the details below before sending. Ensure the date is correct.
              </DialogDescription>
            </DialogHeader>
            <div className="py-6 px-4 bg-slate-50/50 rounded-xl border border-slate-100 flex flex-col gap-2">
              <div className="text-xs text-center text-slate-400 mb-2 font-medium">Message Preview</div>
              <div className="self-center w-full max-w-[360px]">
                <div className="bg-[#e7ffdb] p-4 rounded-xl rounded-tr-none shadow-sm text-sm text-slate-800 whitespace-pre-wrap border border-green-100/50 relative">
                  {previewContent}
                  <div className="flex items-center justify-end gap-1 mt-2 select-none">
                    <span className="text-[10px] text-slate-500">Just now</span>
                    {/* Double tick icon simulation */}
                    <div className="flex -space-x-1">
                      <span className="text-blue-500 text-[10px]">✓</span>
                      <span className="text-blue-500 text-[10px]">✓</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setPreviewOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmSend}
                disabled={sendReminderMutation.isPending}
              >
                {sendReminderMutation.isPending && !previewOpen ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Confirm & Send
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Book MOT Dialog */}
        {selectedVehicleForMOT && (
          <BookMOTDialog
            open={isBookMOTOpen}
            onOpenChange={setIsBookMOTOpen}
            vehicleId={selectedVehicleForMOT.id}
            registration={selectedVehicleForMOT.registration}
            currentExpiryDate={selectedVehicleForMOT.currentExpiry}
            onSuccess={() => refetch()}
          />
        )}

        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteMode === "single" ? "Delete Vehicle" : `Delete ${selectedVehicleIds.size} Vehicles`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteMode === "single"
                  ? "Are you sure you want to delete this vehicle? This will also remove all associated reminders. This action cannot be undone."
                  : `Are you sure you want to delete ${selectedVehicleIds.size} vehicles? This action cannot be undone.`
                }
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirmDelete();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteVehicleMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmConfig?.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirmConfig?.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirmConfig?.onConfirm();
                  setConfirmOpen(false);
                }}
                className={confirmConfig?.actionVariant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              >
                {confirmConfig?.actionLabel || "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Service History Dialog */}
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Service History: {selectedVehicleForHistory?.registration}</DialogTitle>
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
