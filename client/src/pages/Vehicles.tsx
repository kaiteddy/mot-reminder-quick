import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Car, Search, Fuel } from "lucide-react";
import { MOTRefreshButton } from "@/components/MOTRefreshButton";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

export default function Vehicles() {
  const [searchTerm, setSearchTerm] = useState("");
  const [, setLocation] = useLocation();
  const { data: vehicles, isLoading, refetch } = trpc.vehicles.list.useQuery();

  const filteredVehicles = vehicles?.filter((vehicle) => {
    const search = searchTerm.toLowerCase();
    return (
      vehicle.registration?.toLowerCase().includes(search) ||
      vehicle.make?.toLowerCase().includes(search) ||
      vehicle.model?.toLowerCase().includes(search) ||
      vehicle.vin?.toLowerCase().includes(search)
    );
  }) || [];

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-GB");
  };

  const getDaysUntilMOT = (motExpiry: Date | string | null) => {
    if (!motExpiry) return null;
    const today = new Date();
    const expiry = new Date(motExpiry);
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Vehicles</h1>
            <p className="text-muted-foreground mt-2">
              Manage your vehicle database
            </p>
          </div>
        </div>

        {/* Search */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Car className="w-5 h-5" />
                  Vehicle List
                </CardTitle>
                <CardDescription>
                  {vehicles?.length || 0} vehicles in database
                </CardDescription>
              </div>
              <MOTRefreshButton
                vehicleIds={filteredVehicles.map(v => v.id)}
                label="Refresh MOT & Tax"
                variant="outline"
                size="sm"
                onComplete={refetch}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by registration, make, model, or VIN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1"
              />
            </div>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading vehicles...
              </div>
            ) : filteredVehicles.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Registration</TableHead>
                      <TableHead>Make & Model</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>MOT Expiry</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredVehicles.map((vehicle) => {
                      const daysUntilMOT = getDaysUntilMOT(vehicle.motExpiryDate);

                      return (
                        <TableRow
                          key={vehicle.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors group"
                          onClick={() => setLocation(`/view-vehicle/${encodeURIComponent(vehicle.registration || "")}`)}
                        >
                          <TableCell>
                            <div className="bg-yellow-400 text-black px-2 py-0.5 rounded font-mono font-bold text-sm border border-black inline-block shadow-sm group-hover:scale-105 transition-transform">
                              {vehicle.registration}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-bold text-base">
                                {vehicle.make || "Unknown"} {vehicle.model || ""}
                              </div>
                              {vehicle.colour && (
                                <div className="text-xs text-muted-foreground flex items-center gap-1">
                                  <div className="w-2 h-2 rounded-full border border-border" style={{ backgroundColor: vehicle.colour.toLowerCase() }} />
                                  {vehicle.colour}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs space-y-1">
                              {vehicle.fuelType && (
                                <div className="text-muted-foreground flex items-center gap-1">
                                  <Fuel className="w-3 h-3" />
                                  {vehicle.fuelType}
                                  {vehicle.engineCC && ` • ${vehicle.engineCC}cc`}
                                </div>
                              )}
                              {vehicle.vin && (
                                <div className="text-[10px] text-muted-foreground font-mono opacity-60">
                                  {vehicle.vin}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {vehicle.motExpiryDate ? (
                              <div className="space-y-1">
                                <div className="text-sm font-medium">
                                  {formatDate(vehicle.motExpiryDate)}
                                </div>
                                {daysUntilMOT !== null && (
                                  <Badge
                                    variant="outline"
                                    className={
                                      daysUntilMOT < 0
                                        ? "bg-red-50 text-red-700 border-red-200 shadow-sm"
                                        : daysUntilMOT <= 30
                                          ? "bg-orange-50 text-orange-700 border-orange-200 shadow-sm"
                                          : daysUntilMOT <= 60
                                            ? "bg-yellow-50 text-yellow-700 border-yellow-200 shadow-sm"
                                            : "bg-green-50 text-green-700 border-green-200 shadow-sm"
                                    }
                                  >
                                    {daysUntilMOT < 0
                                      ? `Expired ${Math.abs(daysUntilMOT)}d ago`
                                      : `${daysUntilMOT}d left`}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">No MOT Data</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              View Details
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Car className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>
                  {searchTerm
                    ? "No vehicles found matching your search"
                    : "No vehicles in database"}
                </p>
                {!searchTerm && (
                  <p className="text-sm mt-2">
                    Import data from Garage Assistant 4 to get started
                  </p>
                )}
              </div>
            )}

            {searchTerm && filteredVehicles.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Showing {filteredVehicles.length} of {vehicles?.length} vehicles
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
