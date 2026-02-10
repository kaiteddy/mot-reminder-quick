import { useState, useMemo, useEffect } from "react";
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
  Calendar
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
import { toast } from "sonner";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { ComprehensiveVehicleTable } from "@/components/ComprehensiveVehicleTable";
import { BookMOTDialog } from "@/components/BookMOTDialog";
import { APP_TITLE } from "@/const";
import { ImageUpload } from "@/components/ImageUpload";
import { ServiceHistory } from "@/components/ServiceHistory";

type SortField = "registration" | "customer" | "make" | "motExpiry" | "lastSent";
type MOTStatusFilter = "all" | "expired" | "due" | "valid";
type TaxStatusFilter = "all" | "taxed" | "untaxed" | "sorn";
type DateRangeFilter = "all" | "expired-all" | "expired-90" | "expired-60" | "expired-30" | "expired-7" | "expiring-7" | "expiring-14" | "expiring-30" | "expiring-60" | "expiring-90";

export default function Home() {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("registration");
  const [motStatusFilter, setMOTStatusFilter] = useState<MOTStatusFilter>("all");
  const [taxStatusFilter, setTaxStatusFilter] = useState<TaxStatusFilter>("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
  const [showDeadVehicles, setShowDeadVehicles] = useState(false);
  const [hideMissingPhone, setHideMissingPhone] = useState(true);
  const [hideSorn, setHideSorn] = useState(true);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<number>>(new Set());
  const [isSendingBatch, setIsSendingBatch] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // History State
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVehicleForHistory, setSelectedVehicleForHistory] = useState<{ id: number, registration: string } | null>(null);

  // Preview State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [pendingVehicle, setPendingVehicle] = useState<any>(null);

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
    const reminderType = status === "expired" || status === "due" ? "MOT" : "Service";

    if (status === "valid" && daysLeft && daysLeft > 60) {
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
      setSelectedVehicleIds(new Set(filteredAndSortedVehicles.filter(v => v.customerPhone).map(v => v.id)));
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
    const vehiclesToSend = filteredAndSortedVehicles.filter(v => selectedVehicleIds.has(v.id));
    if (vehiclesToSend.length === 0) return;

    setIsSendingBatch(true);
    let successCount = 0;
    for (const vehicle of vehiclesToSend) {
      if (!vehicle.customerPhone) continue;
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

      // Filter: Hide SORN vehicles
      if (hideSorn && vehicle.taxStatus?.toLowerCase() === 'sorn') {
        return false;
      }

      const termLower = searchTerm.toLowerCase();
      const matchesSearch = (vehicle.registration?.toLowerCase() || "").includes(termLower.replace(/\s+/g, '')) ||
        (vehicle.customerName?.toLowerCase() || "").includes(termLower) ||
        (vehicle.make?.toLowerCase() || "").includes(termLower);
      if (!matchesSearch) return false;

      if (motStatusFilter !== "all" && getMOTStatus(vehicle.motExpiryDate).status !== motStatusFilter) return false;
      if (taxStatusFilter !== "all") {
        const status = vehicle.taxStatus?.toLowerCase() || "untaxed";
        if (taxStatusFilter !== status) return false;
      }
      if (dateRangeFilter !== "all") {
        if (!vehicle.motExpiryDate) return false;
        const today = new Date();
        const lastSent = vehicle.lastReminderSent ? new Date(vehicle.lastReminderSent).getTime() : 0;
        if ((today.getTime() - lastSent) < 30 * 24 * 60 * 60 * 1000) return false;
        const expiry = new Date(vehicle.motExpiryDate);
        const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        switch (dateRangeFilter) {
          case "expired-all": if (diffDays >= 0) return false; break;
          case "expired-90": if (diffDays >= 0 || diffDays < -90) return false; break;
          case "expired-60": if (diffDays >= 0 || diffDays < -60) return false; break;
          case "expired-30": if (diffDays >= 0 || diffDays < -30) return false; break;
          case "expired-7": if (diffDays >= 0 || diffDays < -7) return false; break;
          case "expiring-7": if (diffDays < 0 || diffDays > 7) return false; break;
          case "expiring-14": if (diffDays < 0 || diffDays > 14) return false; break;
          case "expiring-30": if (diffDays < 0 || diffDays > 30) return false; break;
          case "expiring-60": if (diffDays < 0 || diffDays > 60) return false; break;
          case "expiring-90": if (diffDays < 0 || diffDays > 90) return false; break;
        }
      }
      return true;
    });
    return filtered;
  }, [vehicles, searchTerm, motStatusFilter, taxStatusFilter, dateRangeFilter, showDeadVehicles]);

  const stats = useMemo(() => {
    if (!vehicles) return { total: 0, expired: 0, due: 0, valid: 0, noData: 0, expired90: 0, expired60: 0, expired30: 0, expired7: 0, expiring7: 0, expiring14: 0, expiring30: 0, expiring60: 0, expiring90: 0 };
    let expired = 0, due = 0, valid = 0, noData = 0, e90 = 0, e60 = 0, e30 = 0, e7 = 0, x7 = 0, x14 = 0, x30 = 0, x60 = 0, x90 = 0;
    const today = new Date();
    vehicles.forEach(vehicle => {
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
    return { total: vehicles.length, expired, due, valid, noData, expired90: e90, expired60: e60, expired30: e30, expired7: e7, expiring7: x7, expiring14: x14, expiring30: x30, expiring60: x60, expiring90: x90 };
  }, [vehicles]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">{APP_TITLE}</h1>
            <p className="text-muted-foreground mt-2">Dashboard Overview</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowUpload(!showUpload)}>
              <Search className="w-4 h-4 mr-2" /> Upload Screenshot
            </Button>
            <MOTRefreshButtonLive registrations={filteredAndSortedVehicles.map(v => v.registration).filter(Boolean)} label="Refresh Visible" onComplete={refetch} />
          </div>
        </div>

        {showUpload && <ImageUpload onImageUpload={handleImageUpload} isProcessing={isProcessing} />}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card><CardHeader className="pb-3"><CardDescription>Total</CardDescription><CardTitle className="text-3xl">{stats.total}</CardTitle></CardHeader></Card>
          <Card className="bg-red-50"><CardHeader className="pb-3"><CardDescription>Expired</CardDescription><CardTitle className="text-red-600 text-3xl">{stats.expired}</CardTitle></CardHeader></Card>
          <Card className="bg-orange-50"><CardHeader className="pb-3"><CardDescription>Due Soon</CardDescription><CardTitle className="text-orange-600 text-3xl">{stats.due}</CardTitle></CardHeader></Card>
          <Card className="bg-green-50"><CardHeader className="pb-3"><CardDescription>Valid</CardDescription><CardTitle className="text-green-600 text-3xl">{stats.valid}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-3"><CardDescription>No Data</CardDescription><CardTitle className="text-3xl">{stats.noData}</CardTitle></CardHeader></Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
              </div>
              <Select value={dateRangeFilter} onValueChange={(v) => setDateRangeFilter(v as any)}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Date Range" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dates</SelectItem>
                  <SelectItem value="expiring-30">Next 30 Days</SelectItem>
                  <SelectItem value="expired-30">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-4 mt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show-dead-home"
                  checked={showDeadVehicles}
                  onCheckedChange={(checked) => setShowDeadVehicles(checked as boolean)}
                />
                <label
                  htmlFor="show-dead-home"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Show Dead Vehicles
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="hide-no-phone-home"
                  checked={hideMissingPhone}
                  onCheckedChange={(checked) => setHideMissingPhone(checked as boolean)}
                />
                <label
                  htmlFor="hide-no-phone-home"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Hide Missing Phone Numbers
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="hide-sorn-home"
                  checked={hideSorn}
                  onCheckedChange={(checked) => setHideSorn(checked as boolean)}
                />
                <label
                  htmlFor="hide-sorn-home"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Hide SORN Vehicles
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <ComprehensiveVehicleTable
              vehicles={filteredAndSortedVehicles}
              isLoading={isLoading}
              selectedVehicleIds={selectedVehicleIds}
              onSelectAll={handleSelectAll}
              onSelectOne={handleSelectOne}
              onSendReminder={handleSendReminder}
              onBookMOT={handleBookMOTClick}
              onDelete={handleDelete}
              isDeletingBatch={deleteVehicleMutation.isPending}
              pendingVehicleId={pendingVehicle?.id}
              onViewHistory={(vehicle) => {
                setSelectedVehicleForHistory({ id: vehicle.id, registration: vehicle.registration });
                setHistoryOpen(true);
              }}
            />
          </CardContent>
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
