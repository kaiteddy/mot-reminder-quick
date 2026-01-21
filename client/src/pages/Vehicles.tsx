import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Car, Search } from "lucide-react";
import { MOTRefreshButton } from "@/components/MOTRefreshButton";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

export default function Vehicles() {
  const [searchTerm, setSearchTerm] = useState("");
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
                        <TableRow key={vehicle.id}>
                          <TableCell className="font-mono font-bold">
                            {vehicle.registration}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                {vehicle.make || "Unknown"} {vehicle.model || ""}
                              </div>
                              {vehicle.colour && (
                                <div className="text-sm text-muted-foreground">
                                  {vehicle.colour}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm space-y-1">
                              {vehicle.fuelType && (
                                <div className="text-muted-foreground">
                                  {vehicle.fuelType}
                                  {vehicle.engineCC && ` • ${vehicle.engineCC}cc`}
                                </div>
                              )}
                              {vehicle.vin && (
                                <div className="text-xs text-muted-foreground font-mono">
                                  VIN: {vehicle.vin}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {vehicle.motExpiryDate ? (
                              <div className="space-y-1">
                                <div className="text-sm">
                                  {formatDate(vehicle.motExpiryDate)}
                                </div>
                                {daysUntilMOT !== null && (
                                  <Badge
                                    variant="outline"
                                    className={
                                      daysUntilMOT < 0
                                        ? "bg-red-50 text-red-700 border-red-200"
                                        : daysUntilMOT <= 30
                                          ? "bg-orange-50 text-orange-700 border-orange-200"
                                          : daysUntilMOT <= 60
                                            ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                            : "bg-green-50 text-green-700 border-green-200"
                                    }
                                  >
                                    {daysUntilMOT < 0
                                      ? `Expired ${Math.abs(daysUntilMOT)}d ago`
                                      : `${daysUntilMOT}d left`}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/view-vehicle/${encodeURIComponent(vehicle.registration || "")}`}>
                              <Button variant="ghost" size="sm">
                                View Details
                              </Button>
                            </Link>
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
