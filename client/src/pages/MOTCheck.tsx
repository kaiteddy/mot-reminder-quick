import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  FileText,
  Sparkles,
  ChevronDown
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatMOTDate, getMOTStatusBadge, formatDaysUntilExpiry } from "@/lib/motUtils";
import DashboardLayout from "@/components/DashboardLayout";
import { CustomerInfoCard } from "@/components/CustomerInfoCard";
import { AutodataMini } from "@/components/AutodataMini";
import { MOTEstimateCreator } from "@/components/MOTEstimateCreator";
import { OmnipartIntegration } from "@/components/OmnipartLookup";
import { MOTMileageChart } from "@/components/MOTMileageChart";
import { ServiceHistory } from "@/components/ServiceHistory";

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
  vin?: string;
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
  const [customerData, setCustomerData] = useState<any>(null);
  const hasSearched = useRef(false);

  const [recentMOTSearches, setRecentMOTSearches] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("mot_recent_vrms");
    if (saved) {
      try {
        setRecentMOTSearches(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const lookupMutation = trpc.reminders.lookupMOT.useMutation({
    onSuccess: async (data) => {
      setVehicleData(data as VehicleData);
      toast.success("Vehicle found!");

      // Try to fetch customer profile data
      try {
        const res = await fetch(`/api/customer-lookup/${data.registration}`);
        const cData = await res.json();
        if (cData.success && cData.customer) {
          setCustomerData(cData);
        } else {
          setCustomerData(null);
        }
      } catch (e) {
        console.error("Customer lookup failed", e);
        setCustomerData(null);
      }
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
    const cleanReg = registration.replace(/\s+/g, '').toUpperCase();
    
    setRecentMOTSearches(prev => {
        const newSearches = [cleanReg, ...prev.filter(v => v !== cleanReg)].slice(0, 5);
        localStorage.setItem("mot_recent_vrms", JSON.stringify(newSearches));
        return newSearches;
    });
    
    lookupMutation.mutate({ registration: cleanReg });
  };

  useEffect(() => {
    if (hasSearched.current) return;
    const searchParams = new URLSearchParams(window.location.search);
    const regParam = searchParams.get('reg');
    if (regParam) {
      const cleanReg = regParam.replace(/\s+/g, '').toUpperCase();
      setRegistration(cleanReg);
      setRecentMOTSearches(prev => {
          const newSearches = [cleanReg, ...prev.filter(v => v !== cleanReg)].slice(0, 5);
          localStorage.setItem("mot_recent_vrms", JSON.stringify(newSearches));
          return newSearches;
      });
      lookupMutation.mutate({ registration: cleanReg });
      hasSearched.current = true;
    }
  }, []);

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
              Enter a UK vehicle registration to check MOT history. Try <strong>RF67NRO</strong> to see a demo of the expiry display.
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
                  placeholder="ENTER REG"
                  className="text-center font-mono uppercase bg-[#FDD017] text-black border-4 border-slate-900 rounded-lg font-bold shadow-inner placeholder:text-black/30 h-16 text-3xl tracking-widest focus-visible:ring-offset-0 focus-visible:ring-black"
                  maxLength={8}
                />
                
                {recentMOTSearches.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-3 pl-1">
                    <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Recent:</span>
                    {recentMOTSearches.map((vrm) => (
                      <Badge 
                        key={vrm} 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-slate-200 text-xs font-mono border border-slate-200"
                        onClick={() => {
                           setRegistration(vrm);
                           lookupMutation.mutate({ registration: vrm });
                        }}
                      >
                        {vrm}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button 
                type="submit" 
                disabled={lookupMutation.isPending || !registration}
                className="h-16 px-8 text-lg font-medium shadow-sm transition-all rounded-lg"
              >             {lookupMutation.isPending ? (
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
          <div className="space-y-6">
            <CustomerInfoCard customer={customerData?.customer} vehicleId={customerData?.vehicle?.id} />

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
                  {vehicleData.vin && (
                    <div className="flex items-center gap-2 lg:col-span-2">
                      <FileText className="w-4 h-4 text-slate-500" />
                      <div>
                        <div className="text-xs text-slate-500">VIN</div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold uppercase">{vehicleData.vin}</span>
                          <a href={`https://partsouq.com/en/search/all?q=${vehicleData.vin}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                            Search on PartSouq
                          </a>
                        </div>
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

            {/* Embedded Drone Technical Data */}
            <div className="mb-2">
              <AutodataMini 
                vrm={vehicleData.registration}
              />
            </div>

            {/* MOT Mileage History Chart */}
            {vehicleData.motTests && vehicleData.motTests.length > 0 && (
              <MOTMileageChart tests={vehicleData.motTests} />
            )}

            {/* Omnipart Trade Lookup Integration */}
            <div className="mb-6">
              <OmnipartIntegration defaultVrm={vehicleData.registration} />
            </div>

            {/* MOT History */}
            {vehicleData.motTests && vehicleData.motTests.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>MOT Test History</CardTitle>
                  <CardDescription>
                    {vehicleData.motTests.length} test{vehicleData.motTests.length !== 1 ? "s" : ""} on record
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-3 py-3">
                  <div className="space-y-2">
                    {vehicleData.motTests.map((test, index) => (
                      <MOTTestCard key={index} test={test} vehicleData={vehicleData} isLatest={index === 0} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Service / Invoicing History */}
            {customerData?.vehicle?.id && (
              <Card>
                <CardHeader>
                  <CardTitle>Invoicing & Service History</CardTitle>
                  <CardDescription>
                    All archived invoices and job sheets for this vehicle
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ServiceHistory vehicleId={customerData.vehicle.id} />
                </CardContent>
              </Card>
            )}
          </div>
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

function MOTTestCard({ test, vehicleData, isLatest = false }: { test: MOTTest; vehicleData?: VehicleData; isLatest?: boolean }) {
  const isPassed = test.testResult === "PASSED";
  const testDate = new Date(test.completedDate);
  const [isOpen, setIsOpen] = useState(isLatest);

  return (
    <div className="border rounded-lg p-2.5 space-y-2 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div 
        className="flex items-start justify-between cursor-pointer group"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          {isPassed ? (
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          ) : (
            <XCircle className="w-6 h-6 text-red-600" />
          )}
          <div>
            <div className="font-semibold text-lg flex items-center gap-2">
              {testDate.toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
              {!isLatest && (
                 <Badge variant="outline" className="text-xs bg-slate-50">Historical</Badge>
              )}
            </div>
            <div className="text-sm text-slate-500">
              Test Number: {test.motTestNumber || "N/A"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={isPassed ? "default" : "destructive"}>
            {test.testResult}
          </Badge>
          <div className="bg-slate-100 p-1 rounded-full group-hover:bg-slate-200 transition-colors">
            <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="pt-2 animate-in slide-in-from-top-2 duration-300 space-y-2 border-t mt-2">
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
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-50 p-1.5 rounded w-fit">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span>Advisories & Defects ({test.defects.length})</span>
              </div>
              <div className="space-y-1 pl-1">
            {test.defects.map((defect, idx) => {
              const isDangerous = defect.dangerous || defect.type === "DANGEROUS";
              const isMajor = defect.type === "MAJOR" || defect.type === "FAIL";
              const isMinor = defect.type === "MINOR" || defect.type === "PRS";
              const isAdvisory = defect.type === "ADVISORY";
              
              let baseClasses = "text-sm p-3 rounded mb-2 flex items-start gap-2 ";
              if (isDangerous) {
                baseClasses += "bg-red-600 text-white shadow-md font-medium";
              } else if (isMajor) {
                baseClasses += "bg-red-50 text-red-900 border border-red-200";
              } else if (isMinor) {
                baseClasses += "bg-orange-50 text-orange-900 border border-orange-200";
              } else if (isAdvisory) {
                baseClasses += "bg-yellow-50 text-yellow-900 border border-yellow-200";
              } else {
                baseClasses += "bg-slate-50 text-slate-700 border border-slate-200";
              }

              return (
                <div key={idx} className={baseClasses}>
                  <span className={`font-bold text-[11px] uppercase tracking-wide shrink-0 mt-0.5 ${
                    isDangerous ? "text-red-100" : 
                    isMajor ? "text-red-600" : 
                    isMinor ? "text-orange-600" : 
                    isAdvisory ? "text-yellow-600" : "text-slate-500"
                  }`}>
                    {isDangerous ? "DANGEROUS" : defect.type}
                  </span>
                  <span className={isDangerous ? "text-white leading-tight" : "leading-tight"}>{defect.text}</span>
                  {vehicleData && <DefectExplanationPopover defectText={defect.text} vehicle={vehicleData} isDangerous={isDangerous} />}
                </div>
              );
            })}
          </div>
          
          {/* Estimate Creator specifically for tests with actual defects (including advisories) */}
          {test.defects.length > 0 && vehicleData && (
            <div className="pt-4 border-t mt-4">
              <MOTEstimateCreator 
                vehicleDetails={{
                  make: vehicleData.make,
                  model: vehicleData.model,
                  year: vehicleData.yearOfManufacture
                }} 
                defects={test.defects} 
              />
            </div>
          )}
        </div>
      )}
      
      {/* End of content collapse wrapper */}
        </div>
      )}
    </div>
  );
}

function DefectExplanationPopover({ defectText, vehicle, isDangerous }: { defectText: string, vehicle?: VehicleData, isDangerous?: boolean }) {
  const [open, setOpen] = useState(false);
  const explainMutation = trpc.ai.explainDefect.useMutation();

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && !explainMutation.data && !explainMutation.isPending && !explainMutation.isError) {
      explainMutation.mutate({
        defect: defectText,
        make: vehicle?.make,
        model: vehicle?.model,
        year: vehicle?.yearOfManufacture,
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button 
          className={`ml-auto shrink-0 flex items-center justify-center p-1.5 rounded-full transition-colors opacity-70 hover:opacity-100 ${isDangerous ? 'hover:bg-red-700 text-white' : 'hover:bg-black/5 text-slate-500 hover:text-slate-800'}`}
          title="Explain this issue"
        >
          <Sparkles className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm p-4 z-[100]" align="end">
        <div className="space-y-3">
          <h4 className="font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Explanation
          </h4>
          {explainMutation.isPending ? (
            <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
              <p className="text-xs">Translating to plain English...</p>
            </div>
          ) : explainMutation.isError ? (
            <p className="text-destructive text-xs py-2">Failed to get explanation. Please try again.</p>
          ) : explainMutation.data ? (
            <p className="text-slate-700 leading-relaxed text-[13.5px] pt-3 border-t font-medium">{explainMutation.data.explanation}</p>
          ) : (
            <p className="text-muted-foreground text-xs py-2">Loading...</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
