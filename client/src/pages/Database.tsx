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
  MessageSquare,
  Send
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";

type SortField = "registration" | "customer" | "make" | "motExpiry";
type SortDirection = "asc" | "desc";
type MOTStatusFilter = "all" | "expired" | "due" | "valid";
type DateRangeFilter = "all" | "expired-90" | "expired-60" | "expired-30" | "expired-7" | "expiring-7" | "expiring-14" | "expiring-30" | "expiring-60" | "expiring-90";

export default function Database() {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("registration");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [motStatusFilter, setMOTStatusFilter] = useState<MOTStatusFilter>("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
  const [selectedVehicles, setSelectedVehicles] = useState<Set<number>>(new Set());

  const { data: vehicles, isLoading, refetch } = trpc.database.getAllVehiclesWithCustomers.useQuery();
  
  const bulkSendMutation = trpc.reminders.bulkSendReminders.useMutation({
    onSuccess: (result) => {
      toast.success(`Sent ${result.sent} reminder${result.sent > 1 ? 's' : ''}!`);
      if (result.failed > 0) {
        toast.error(`Failed: ${result.failed}. Errors: ${result.errors.slice(0, 3).join(", ")}`);
      }
      setSelectedVehicles(new Set());
      refetch();
    },
    onError: (error) => {
      toast.error(`Bulk send failed: ${error.message}`);
    },
  });
  
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

  const handleBulkUpdate = () => {
    if (!vehicles || vehicles.length === 0) {
      toast.error("No vehicles to update");
      return;
    }
    
    toast.info(`Starting bulk MOT check for ${vehicles.length} vehicles...`);
    bulkUpdateMutation.mutate({});
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
      }
      
      if (sortDirection === "asc") {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
    
    return filtered;
  }, [vehicles, searchTerm, sortField, sortDirection, motStatusFilter, dateRangeFilter]);

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
    
    vehicles.forEach(vehicle => {
      const { status } = getMOTStatus(vehicle.motExpiryDate);
      if (!vehicle.motExpiryDate) {
        noData++;
      } else {
        const expiry = new Date(vehicle.motExpiryDate);
        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (status === "expired") {
          expired++;
          if (diffDays >= -90) expired90++;
          if (diffDays >= -60) expired60++;
          if (diffDays >= -30) expired30++;
          if (diffDays >= -7) expired7++;
        } else if (status === "due") {
          due++;
        } else {
          valid++;
        }
        
        // Count expiring vehicles
        if (diffDays >= 0 && diffDays <= 7) expiring7++;
        if (diffDays >= 0 && diffDays <= 14) expiring14++;
        if (diffDays >= 0 && diffDays <= 30) expiring30++;
        if (diffDays >= 0 && diffDays <= 60) expiring60++;
        if (diffDays >= 0 && diffDays <= 90) expiring90++;
      }
    });
    
    return { 
      total: vehicles.length, expired, due, valid, noData,
      expired90, expired60, expired30, expired7,
      expiring7, expiring14, expiring30, expiring60, expiring90
    };
  }, [vehicles]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
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
            <Button variant="outline" asChild>
              <Link href="/">← Back to Home</Link>
            </Button>
            {stats.noData > 0 && (
              <Button variant="outline" asChild>
                <Link href="/diagnose-mot">
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Diagnose {stats.noData} Missing MOT
                </Link>
              </Button>
            )}
            <Button 
              onClick={() => {
                const visibleIds = filteredAndSortedVehicles.map(v => v.id);
                if (visibleIds.length === 0) {
                  toast.error("No vehicles to update");
                  return;
                }
                bulkUpdateMutation.mutate({ vehicleIds: visibleIds });
              }}
              disabled={bulkUpdateMutation.isPending || isLoading}
              variant="outline"
              className="gap-2"
            >
              {bulkUpdateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Refresh Visible ({filteredAndSortedVehicles.length})
                </>
              )}
            </Button>
            <Button 
              onClick={handleBulkUpdate}
              disabled={bulkUpdateMutation.isPending || isLoading}
              className="gap-2"
            >
              {bulkUpdateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Bulk MOT Check (All)
                </>
              )}
            </Button>
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
            <div className="mt-2 text-sm text-slate-600">
              Showing {filteredAndSortedVehicles.length} of {stats.total} vehicles
            </div>
          </CardContent>
        </Card>

        {/* Bulk Actions Toolbar */}
        {selectedVehicles.size > 0 && (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                  <span className="font-medium text-blue-900">
                    {selectedVehicles.size} vehicle{selectedVehicles.size > 1 ? 's' : ''} selected
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedVehicles(new Set())}
                  >
                    Clear Selection
                  </Button>
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={bulkSendMutation.isPending}
                    onClick={() => {
                      bulkSendMutation.mutate({
                        vehicleIds: Array.from(selectedVehicles),
                      });
                    }}
                  >
                    <Send className="w-4 h-4" />
                    Send Reminders ({selectedVehicles.size})
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedVehicles.size === filteredAndSortedVehicles.length && filteredAndSortedVehicles.length > 0}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedVehicles(new Set(filteredAndSortedVehicles.map(v => v.id)));
                          } else {
                            setSelectedVehicles(new Set());
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead className="cursor-pointer w-28" onClick={() => toggleSort("registration")}>
                      <div className="flex items-center gap-1">
                        Reg
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("customer")}>
                      <div className="flex items-center gap-1">
                        Customer
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="cursor-pointer hidden lg:table-cell" onClick={() => toggleSort("make")}>
                      <div className="flex items-center gap-1">
                        Vehicle
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("motExpiry")}>
                      <div className="flex items-center gap-1">
                        MOT
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </TableHead>
                    <TableHead className="w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedVehicles.map((vehicle) => {
                    const { status, daysLeft } = getMOTStatus(vehicle.motExpiryDate);
                    return (
                      <TableRow 
                        key={vehicle.id} 
                        className={`cursor-pointer hover:bg-slate-100 ${
                          status === "expired" ? "bg-red-50" :
                          status === "due" ? "bg-orange-50" :
                          ""
                        }`}
                        onClick={(e) => {
                          // Don't navigate if clicking checkbox
                          if ((e.target as HTMLElement).closest('input[type="checkbox"]')) {
                            return;
                          }
                          window.location.href = `/vehicles/${vehicle.registration}`;
                        }}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedVehicles.has(vehicle.id)}
                            onCheckedChange={(checked) => {
                              const newSelected = new Set(selectedVehicles);
                              if (checked) {
                                newSelected.add(vehicle.id);
                              } else {
                                newSelected.delete(vehicle.id);
                              }
                              setSelectedVehicles(newSelected);
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-mono font-semibold">
                          {vehicle.registration || "-"}
                        </TableCell>
                        <TableCell>
                          {vehicle.customerName ? (
                            <Link href={`/customers`}>
                              <button className="text-blue-600 hover:text-blue-800 hover:underline font-medium">
                                {vehicle.customerName}
                              </button>
                            </Link>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="font-mono text-sm hidden md:table-cell">{vehicle.customerPhone || "-"}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {vehicle.make || vehicle.model ? (
                            <div>
                              <div className="font-medium">{vehicle.make || "Unknown"}</div>
                              <div className="text-sm text-slate-500">{vehicle.model || ""}</div>
                            </div>
                          ) : "-"}
                        </TableCell>
                        <TableCell>
                          {vehicle.motExpiryDate ? (
                            new Date(vehicle.motExpiryDate).toLocaleDateString("en-GB")
                          ) : (
                            <span className="text-slate-400">No data</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {getMOTStatusBadge(status, daysLeft)}
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
    </div>
  );
}
