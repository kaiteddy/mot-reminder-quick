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
import { Textarea } from "@/components/ui/textarea"; // Assuming we want to show it in a readonly textarea or just a div
import { MOTRefreshButtonLive } from "@/components/MOTRefreshButtonLive";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { BookMOTDialog } from "@/components/BookMOTDialog";
import { CalendarDays } from "lucide-react";

type SortField = "registration" | "customer" | "make" | "motExpiry" | "lastSent";
type SortDirection = "asc" | "desc";
type MOTStatusFilter = "all" | "expired" | "due" | "valid";
type DateRangeFilter = "all" | "expired-90" | "expired-60" | "expired-30" | "expired-7" | "expiring-7" | "expiring-14" | "expiring-30" | "expiring-60" | "expiring-90";

export default function Database() {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("registration");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [motStatusFilter, setMOTStatusFilter] = useState<MOTStatusFilter>("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
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
      if (!window.confirm(`⚠️ Warning: This vehicle's MOT is not due for ${daysLeft} days.\n\nThe "MOT Reminder" message will ask the customer to "Book your MOT test today".\n\nAre you sure you want to send this message now?`)) {
        return;
      }
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

  const handleDelete = async (vehicleId: number) => {
    if (!window.confirm("Are you sure you want to delete this vehicle? This will also remove all associated reminders.")) {
      return;
    }

    try {
      await deleteVehicleMutation.mutateAsync({ vehicleIds: [vehicleId] });
      toast.success("Vehicle deleted");
      await refetch();
    } catch (error) {
      toast.error("Failed to delete vehicle");
    }
  };

  const handleBatchDelete = async () => {
    if (selectedVehicleIds.size === 0) return;

    if (!window.confirm(`Are you sure you want to delete ${selectedVehicleIds.size} vehicles? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteVehicleMutation.mutateAsync({ vehicleIds: Array.from(selectedVehicleIds) });
      toast.success(`Deleted ${selectedVehicleIds.size} vehicles`);
      setSelectedVehicleIds(new Set());
      await refetch();
    } catch (error) {
      toast.error("Failed to delete vehicles");
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
      const matchesSearch =
        vehicle.registration?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vehicle.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vehicle.make?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vehicle.model?.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (motStatusFilter !== "all") {
        const { status } = getMOTStatus(vehicle.motExpiryDate);
        if (status !== motStatusFilter) return false;
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
          // Only count as "Expired" (actionable) if NOT sent recently
          if (!sentRecently) {
            expired++;
            if (diffDays >= -90) expired90++;
            if (diffDays >= -60) expired60++;
            if (diffDays >= -30) expired30++;
            if (diffDays >= -7) expired7++;
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
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                    variant={dateRangeFilter === "expired-90" ? "default" : "outline"}
                    onClick={() => setDateRangeFilter(dateRangeFilter === "expired-90" ? "all" : "expired-90")}
                    className="justify-between"
                  >
                    <span>Last 90 days</span>
                    <Badge variant="secondary" className="ml-2">{stats.expired90}</Badge>
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
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-slate-600">
                Showing {filteredAndSortedVehicles.length} of {stats.total} vehicles
              </div>
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
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedVehicleIds.size > 0 && selectedVehicleIds.size === filteredAndSortedVehicles.filter(v => v.customerPhone).length}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="cursor-pointer w-[120px]" onClick={() => toggleSort("registration")}>
                      <div className="flex items-center gap-1">
                        Reg
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer w-[150px]" onClick={() => toggleSort("customer")}>
                      <div className="flex items-center gap-1">
                        Customer
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </TableHead>
                    <TableHead className="w-[140px]">Contact</TableHead>
                    <TableHead className="cursor-pointer w-[180px]" onClick={() => toggleSort("make")}>
                      <div className="flex items-center gap-1">
                        Vehicle
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer w-[100px]" onClick={() => toggleSort("motExpiry")}>
                      <div className="flex items-center gap-1">
                        MOT
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[100px]">
                      <div
                        className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                        onClick={() => toggleSort("lastSent")}
                      >
                        Last Sent
                        {sortField === "lastSent" && (
                          sortDirection === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                        )}
                      </div>
                    </TableHead>
                    <TableHead className="w-[90px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedVehicles
                    .slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
                    .map((vehicle) => {
                      const { status, daysLeft } = getMOTStatus(vehicle.motExpiryDate);
                      return (
                        <TableRow key={vehicle.id} className={
                          status === "expired" ? "bg-red-50" :
                            status === "due" ? "bg-orange-50" :
                              ""
                        }>
                          <TableCell>
                            <Checkbox
                              checked={selectedVehicleIds.has(vehicle.id)}
                              onCheckedChange={(checked) => handleSelectOne(vehicle.id, checked as boolean)}
                              disabled={!vehicle.customerPhone || isSendingBatch}
                            />
                          </TableCell>
                          <TableCell className="font-mono font-semibold text-xs">
                            {vehicle.registration || "-"}
                            {vehicle.dateOfRegistration && (
                              <span className="ml-2 text-[10px] text-slate-400 font-normal">
                                ({new Date(vehicle.dateOfRegistration).getFullYear()})
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm truncate max-w-[150px]">{vehicle.customerName || "-"}</TableCell>
                          <TableCell>
                            <div className="text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-700 truncate">{vehicle.customerName || "Unknown"}</span>
                                {vehicle.customerOptedOut && (
                                  <Badge variant="destructive" className="text-xs px-1 py-0">OPTED OUT</Badge>
                                )}
                              </div>
                              <div className="text-slate-500 font-mono">{vehicle.customerPhone || "-"}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {vehicle.make || vehicle.model ? (
                              <div className="text-xs">
                                <div className="font-medium truncate">{vehicle.make || "Unknown"}</div>
                                <div className="text-slate-500 truncate">{vehicle.model || ""}</div>
                              </div>
                            ) : "-"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {vehicle.motExpiryDate ? (
                              new Date(vehicle.motExpiryDate).toLocaleDateString("en-GB")
                            ) : (
                              <span className="text-slate-400">No data</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {getMOTStatusBadge(status, daysLeft)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {vehicle.lastReminderSent ? (
                              <div className="flex flex-col gap-1">
                                <span className="font-medium text-slate-700">
                                  {new Date(vehicle.lastReminderSent).toLocaleDateString("en-GB")}
                                </span>
                                <div className="flex items-center gap-1">
                                  {getDeliveryStatusIcon((vehicle as any).lastReminderStatus)}
                                  <span className="text-[10px] text-slate-400 capitalize">{(vehicle as any).lastReminderStatus || 'queued'}</span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">Never</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSendReminder(vehicle)}
                                disabled={sendReminderMutation.isPending || !vehicle.customerPhone}
                                title="Send Reminder"
                              >
                                {sendReminderMutation.isPending && pendingVehicle?.id === vehicle.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Send className="w-4 h-4" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleBookMOTClick(vehicle)}
                                title="Book MOT (Update Expiry)"
                              >
                                <CalendarDays className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDelete(vehicle.id)}
                                disabled={deleteVehicleMutation.isPending}
                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                title="Delete Vehicle"
                              >
                                {deleteVehicleMutation.isPending ? (
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
            )}
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
      </div>
    </DashboardLayout >
  );
}
