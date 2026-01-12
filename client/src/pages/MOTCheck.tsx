import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Car,
  Calendar,
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Gauge,
  Droplet,
  Palette,
  FileText
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatMOTDate, getMOTStatusBadge, formatDaysUntilExpiry } from "@/lib/motUtils";
import DashboardLayout from "@/components/DashboardLayout";

interface MOTTest {
  completedDate: string;
  testResult: string;
  expiryDate?: string;
  odometerValue?: string;
  odometerUnit?: string;
  motTestNumber?: string;
  defects?: Array<{
    text: string;
    type: string;
    dangerous?: boolean;
  }>;
}

interface VehicleData {
  registration: string;
  make?: string;
  model?: string;
  motExpiryDate?: Date;
  colour?: string;
  fuelType?: string;
  taxStatus?: string;
  taxDueDate?: string;
  motTests?: MOTTest[];
  // Additional DVLA fields
  engineCapacity?: number;
  co2Emissions?: number;
  markedForExport?: boolean;
  monthOfFirstRegistration?: string;
  yearOfManufacture?: number;
  euroStatus?: string;
  realDrivingEmissions?: string;
  dateOfLastV5CIssued?: string;
  typeApproval?: string;
  wheelplan?: string;
  revenueWeight?: number;
  artEndDate?: string;
  // Additional MOT fields
  primaryColour?: string;
  secondaryColour?: string;
  registrationDate?: string;
  manufactureDate?: string;
  firstUsedDate?: string;
  dvlaId?: string;
  motTestDueDate?: string;
}

export default function MOTCheck() {
  const [registration, setRegistration] = useState("");
  const [vehicleData, setVehicleData] = useState<VehicleData | null>(null);

  const lookupMutation = trpc.reminders.lookupMOT.useMutation({
    onSuccess: (data) => {
      setVehicleData(data as VehicleData);
      toast.success("Vehicle found!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Vehicle not found");
      setVehicleData(null);
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!registration) {
      toast.error("Please enter a registration number");
      return;
    }
    lookupMutation.mutate({ registration: registration.toUpperCase() });
  };

  const getDaysUntilExpiry = (expiryDate?: Date) => {
    if (!expiryDate) return null;
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const daysUntilExpiry = vehicleData?.motExpiryDate ? getDaysUntilExpiry(vehicleData.motExpiryDate) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">MOT Check</h1>
            <p className="text-slate-600 mt-1">Check MOT history and expiry dates</p>
          </div>
        </div>

        {/* Search Form */}
        <Card>
          <CardHeader>
            <CardTitle>Vehicle Registration</CardTitle>
            <CardDescription>
              Enter a UK vehicle registration to check MOT history. Try <strong>TEST123</strong> to see a demo of the expiry display.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearch} className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="registration" className="sr-only">
                  Registration
                </Label>
                <Input
                  id="registration"
                  value={registration}
                  onChange={(e) => setRegistration(e.target.value.toUpperCase())}
                  placeholder="e.g., AB12 CDE"
                  className="text-lg font-mono"
                  maxLength={8}
                />
              </div>
              <Button type="submit" size="lg" disabled={lookupMutation.isPending}>
                {lookupMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5 mr-2" />
                    Check MOT
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Vehicle Details */}
        {vehicleData && (
          <>
            {/* MOT Status Card */}
            <Card className="border-2">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-2xl font-mono">
                      {vehicleData.registration}
                    </CardTitle>
                    <CardDescription className="text-lg mt-1">
                      {vehicleData.make} {vehicleData.model}
                    </CardDescription>
                  </div>
                  {vehicleData.motExpiryDate && (() => {
                    const motInfo = formatMOTDate(vehicleData.motExpiryDate);
                    if (typeof motInfo === 'string') return null;
                    const badge = getMOTStatusBadge(motInfo);
                    return (
                      <Badge variant={badge.variant} className={`text-sm px-3 py-1 ${badge.className || ''}`}>
                        {badge.text}
                      </Badge>
                    );
                  })()}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* MOT Expiry */}
                {vehicleData.motExpiryDate && (() => {
                  const motInfo = formatMOTDate(vehicleData.motExpiryDate);
                  if (typeof motInfo === 'string') return null;
                  return (
                    <Alert className={
                      motInfo.isExpired
                        ? "border-red-500 bg-red-50"
                        : motInfo.daysUntilExpiry <= 30
                          ? "border-orange-500 bg-orange-50"
                          : "border-green-500 bg-green-50"
                    }>
                      <Calendar className="h-4 w-4" />
                      <AlertDescription>
                        <div className="font-semibold text-lg mb-1">
                          MOT Expires: {motInfo.date}
                        </div>
                        <div className={
                          motInfo.isExpired
                            ? "text-red-700 font-medium"
                            : motInfo.daysUntilExpiry <= 30
                              ? "text-orange-700 font-medium"
                              : "text-green-700 font-medium"
                        }>
                          {formatDaysUntilExpiry(motInfo.daysUntilExpiry)}
                        </div>
                      </AlertDescription>
                    </Alert>
                  );
                })()}

                {/* Vehicle Details Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-2">
                  {vehicleData.colour && (
                    <div className="flex items-center gap-2">
                      <Palette className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">Colour</div>
                        <div className="font-medium">{vehicleData.colour}</div>
                      </div>
                    </div>
                  )}
                  {vehicleData.fuelType && (
                    <div className="flex items-center gap-2">
                      <Droplet className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">Fuel</div>
                        <div className="font-medium">{vehicleData.fuelType}</div>
                      </div>
                    </div>
                  )}
                  {vehicleData.taxStatus && (
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">Tax Status</div>
                        <div className="font-medium">{vehicleData.taxStatus}</div>
                      </div>
                    </div>
                  )}
                  {vehicleData.taxDueDate && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">Tax Due</div>
                        <div className="font-medium">
                          {new Date(vehicleData.taxDueDate).toLocaleDateString("en-GB")}
                        </div>
                      </div>
                    </div>
                  )}
                  {vehicleData.engineCapacity && (
                    <div className="flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">Engine</div>
                        <div className="font-medium">{vehicleData.engineCapacity}cc</div>
                      </div>
                    </div>
                  )}
                  {vehicleData.co2Emissions && (
                    <div className="flex items-center gap-2">
                      <Droplet className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">CO2</div>
                        <div className="font-medium">{vehicleData.co2Emissions} g/km</div>
                      </div>
                    </div>
                  )}
                  {vehicleData.yearOfManufacture && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">Year</div>
                        <div className="font-medium">{vehicleData.yearOfManufacture}</div>
                      </div>
                    </div>
                  )}
                  {vehicleData.euroStatus && (
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">Euro Status</div>
                        <div className="font-medium">{vehicleData.euroStatus}</div>
                      </div>
                    </div>
                  )}
                  {vehicleData.monthOfFirstRegistration && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">First Reg</div>
                        <div className="font-medium">{vehicleData.monthOfFirstRegistration}</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* MOT History */}
            {vehicleData.motTests && vehicleData.motTests.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>MOT Test History</CardTitle>
                  <CardDescription>
                    {vehicleData.motTests.length} test{vehicleData.motTests.length !== 1 ? "s" : ""} on record
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {vehicleData.motTests.map((test, index) => (
                      <MOTTestCard key={index} test={test} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Empty State */}
        {!vehicleData && !lookupMutation.isPending && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Car className="w-16 h-16 text-slate-300 mb-4" />
              <p className="text-slate-500 text-center">
                Enter a registration number above to check MOT history
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function MOTTestCard({ test }: { test: MOTTest }) {
  const isPassed = test.testResult === "PASSED";
  const testDate = new Date(test.completedDate);

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {isPassed ? (
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          ) : (
            <XCircle className="w-6 h-6 text-red-600" />
          )}
          <div>
            <div className="font-semibold text-lg">
              {testDate.toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </div>
            <div className="text-sm text-slate-500">
              Test Number: {test.motTestNumber || "N/A"}
            </div>
          </div>
        </div>
        <Badge variant={isPassed ? "default" : "destructive"}>
          {test.testResult}
        </Badge>
      </div>

      {/* Mileage */}
      {test.odometerValue && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Gauge className="w-4 h-4" />
          <span>
            {parseInt(test.odometerValue).toLocaleString()} {test.odometerUnit?.toLowerCase() || "miles"}
          </span>
        </div>
      )}

      {/* Expiry Date */}
      {test.expiryDate && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Calendar className="w-4 h-4" />
          <span>
            Valid until: {new Date(test.expiryDate).toLocaleDateString("en-GB")}
          </span>
        </div>
      )}

      {/* Defects */}
      {test.defects && test.defects.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <AlertTriangle className="w-4 h-4" />
            <span>Advisories & Defects ({test.defects.length})</span>
          </div>
          <div className="space-y-1 pl-6">
            {test.defects.map((defect, idx) => (
              <div
                key={idx}
                className={`text-sm p-2 rounded ${defect.dangerous
                  ? "bg-red-50 text-red-900 border border-red-200"
                  : defect.type === "FAIL"
                    ? "bg-orange-50 text-orange-900 border border-orange-200"
                    : "bg-slate-50 text-slate-700"
                  }`}
              >
                <span className="font-medium text-xs uppercase mr-2">
                  {defect.dangerous ? "DANGEROUS" : defect.type}
                </span>
                {defect.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
