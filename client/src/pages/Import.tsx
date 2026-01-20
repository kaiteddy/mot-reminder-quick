import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, CheckCircle2, XCircle, Loader2, Database } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { APP_TITLE } from "@/const";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

type ImportStep = "customers" | "vehicles" | "reminders" | "complete";

interface ImportResult {
  total: number;
  imported: number;
  updated?: number;
  skipped: number;
  errors: string[];
}

export default function Import() {
  const [currentStep, setCurrentStep] = useState<ImportStep | null>(null);
  const [customersFile, setCustomersFile] = useState<File | null>(null);
  const [vehiclesFile, setVehiclesFile] = useState<File | null>(null);
  const [remindersFile, setRemindersFile] = useState<File | null>(null);
  const [templatesFile, setTemplatesFile] = useState<File | null>(null);
  const [enrichWithDVLA, setEnrichWithDVLA] = useState(false);

  const [customersResult, setCustomersResult] = useState<ImportResult | null>(null);
  const [vehiclesResult, setVehiclesResult] = useState<ImportResult | null>(null);
  const [remindersResult, setRemindersResult] = useState<ImportResult | null>(null);

  const { data: stats, refetch: refetchStats } = trpc.import.getImportStats.useQuery();

  const importCustomersMutation = trpc.import.importCustomers.useMutation({
    onSuccess: (result) => {
      setCustomersResult(result);
      if (vehiclesFile) {
        setCurrentStep("vehicles");
      } else if (remindersFile && templatesFile) {
        setCurrentStep("reminders");
      } else {
        setCurrentStep("complete");
      }
      refetchStats();
      toast.success(`Imported ${result.imported} customers`);
    },
    onError: (error: any) => {
      toast.error(error.message);
      setCurrentStep(null);
    },
  });

  const importVehiclesMutation = trpc.import.importVehicles.useMutation({
    onSuccess: (result) => {
      setVehiclesResult(result);
      if (remindersFile && templatesFile) {
        setCurrentStep("reminders");
      } else {
        setCurrentStep("complete");
      }
      refetchStats();
      toast.success(`Imported ${result.imported} vehicles`);
    },
    onError: (error: any) => {
      toast.error(error.message);
      setCurrentStep(null);
    },
  });

  const importRemindersMutation = trpc.import.importReminders.useMutation({
    onSuccess: (result) => {
      setRemindersResult(result);
      setCurrentStep("complete");
      refetchStats();
      toast.success(`Imported ${result.imported} reminders`);
    },
    onError: (error: any) => {
      toast.error(error.message);
      setCurrentStep(null);
    },
  });

  const handleFileChange = (type: "customers" | "vehicles" | "reminders" | "templates", file: File | null) => {
    switch (type) {
      case "customers":
        setCustomersFile(file);
        break;
      case "vehicles":
        setVehiclesFile(file);
        break;
      case "reminders":
        setRemindersFile(file);
        break;
      case "templates":
        setTemplatesFile(file);
        break;
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleStartImport = async () => {
    // Determine start step
    if (customersFile) {
      setCurrentStep("customers");
      const customersData = await fileToBase64(customersFile);
      importCustomersMutation.mutate({ csvData: customersData });
    } else if (vehiclesFile) {
      // Skip straight to vehicles
      setCurrentStep("vehicles");
      // The useEffect/condition below will pick this up, OR we can manually trigger
      // But purely setting state might be cleaner if we use useEffect, but here we use conditional rendering logic
      // Actually, relying on the 'if (currentStep === "vehicles" ...)' block below is better
    } else if (remindersFile && templatesFile) {
      setCurrentStep("reminders");
    } else {
      toast.error("Please select at least one file to import");
    }
  };

  // Auto-progress through steps
  if (currentStep === "vehicles" && vehiclesFile && !importVehiclesMutation.isPending && !vehiclesResult) {
    fileToBase64(vehiclesFile).then((vehiclesData) => {
      importVehiclesMutation.mutate({ csvData: vehiclesData, enrichWithDVLA });
    });
  }

  if (currentStep === "reminders" && remindersFile && templatesFile && !importRemindersMutation.isPending && !remindersResult) {
    Promise.all([
      fileToBase64(remindersFile),
      fileToBase64(templatesFile),
    ]).then(([remindersData, templatesData]) => {
      importRemindersMutation.mutate({ remindersCSV: remindersData, templatesCSV: templatesData });
    });
  }

  const canStartImport = (!!customersFile || !!vehiclesFile || (!!remindersFile && !!templatesFile)) && !currentStep;
  const isImporting = !!(currentStep && currentStep !== "complete");

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Import from Garage Assistant 4</h1>
          <p className="text-muted-foreground mt-2">
            Import your existing customers, vehicles, and reminders
          </p>
        </div>

        {/* Current Statistics */}
        {stats && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Current Database
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Customers</div>
                  <div className="text-2xl font-bold">{stats.customers}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Vehicles</div>
                  <div className="text-2xl font-bold">{stats.vehicles}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Reminders</div>
                  <div className="text-2xl font-bold">{stats.reminders}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* File Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle>Select CSV Files</CardTitle>
            <CardDescription>
              Upload your Garage Assistant 4 export files. Import will process in order: Customers → Vehicles → Reminders.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FileUploadInput
              label="Customers.csv"
              file={customersFile}
              onChange={(file) => handleFileChange("customers", file)}
              disabled={isImporting}
            />

            <FileUploadInput
              label="Vehicles.csv"
              file={vehiclesFile}
              onChange={(file) => handleFileChange("vehicles", file)}
              disabled={isImporting}
            />

            <FileUploadInput
              label="Reminders.csv"
              file={remindersFile}
              onChange={(file) => handleFileChange("reminders", file)}
              disabled={isImporting}
            />

            <FileUploadInput
              label="Reminder_Templates.csv"
              file={templatesFile}
              onChange={(file) => handleFileChange("templates", file)}
              disabled={isImporting}
            />

            <div className="flex items-center gap-2 pt-4">
              <input
                type="checkbox"
                id="enrichDVLA"
                checked={enrichWithDVLA}
                onChange={(e) => setEnrichWithDVLA(e.target.checked)}
                disabled={isImporting || false}
                className="w-4 h-4"
              />
              <label htmlFor="enrichDVLA" className="text-sm">
                Enrich vehicles with DVLA data (MOT expiry, tax status) - slower but more accurate
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Import Progress */}
        {currentStep && (
          <Card>
            <CardHeader>
              <CardTitle>Import Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ImportStepIndicator
                step="customers"
                label="Importing Customers"
                current={currentStep === "customers"}
                completed={customersResult !== null}
                result={customersResult}
                isLoading={importCustomersMutation.isPending}
              />

              <ImportStepIndicator
                step="vehicles"
                label="Importing Vehicles"
                current={currentStep === "vehicles"}
                completed={vehiclesResult !== null}
                result={vehiclesResult}
                isLoading={importVehiclesMutation.isPending}
              />

              <ImportStepIndicator
                step="reminders"
                label="Importing Reminders"
                current={currentStep === "reminders"}
                completed={remindersResult !== null}
                result={remindersResult}
                isLoading={importRemindersMutation.isPending}
              />

              {currentStep === "complete" && (
                <Alert>
                  <CheckCircle2 className="w-4 h-4" />
                  <AlertDescription>
                    Import completed successfully! All data has been imported into {APP_TITLE}.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4">
          <Button
            onClick={handleStartImport}
            disabled={!canStartImport}
            size="lg"
            className="flex-1"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Start Import
              </>
            )}
          </Button>

          {currentStep === "complete" && (
            <Link href="/">
              <Button size="lg" variant="outline">
                View Reminders
              </Button>
            </Link>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function FileUploadInput({
  label,
  required,
  file,
  onChange,
  disabled,
}: {
  label: string;
  required?: boolean;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <label className="text-sm font-medium">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
        <div className="mt-1">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => onChange(e.target.files?.[0] || null)}
            disabled={disabled}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
          />
        </div>
      </div>
      {file && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="w-4 h-4" />
          {file.name}
        </div>
      )}
    </div>
  );
}

function ImportStepIndicator({
  step,
  label,
  current,
  completed,
  result,
  isLoading,
}: {
  step: string;
  label: string;
  current: boolean;
  completed: boolean;
  result: ImportResult | null;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {completed ? (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          ) : current ? (
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-muted" />
          )}
          <span className={`font-medium ${current ? "text-blue-600" : completed ? "text-green-600" : "text-muted-foreground"}`}>
            {label}
          </span>
        </div>

        {result && (
          <div className="flex gap-2">
            <Badge variant="outline" className="bg-green-50">
              {result.imported} imported
            </Badge>
            {result.updated && result.updated > 0 && (
              <Badge variant="outline" className="bg-blue-50">
                {result.updated} updated
              </Badge>
            )}
            {result.skipped > 0 && (
              <Badge variant="outline" className="bg-orange-50">
                {result.skipped} skipped
              </Badge>
            )}
            {result.errors.length > 0 && (
              <Badge variant="outline" className="bg-red-50">
                {result.errors.length} errors
              </Badge>
            )}
          </div>
        )}
      </div>

      {result && result.errors.length > 0 && (
        <div className="ml-7 text-xs text-red-600 space-y-1">
          {result.errors.slice(0, 3).map((error, i) => (
            <div key={i}>• {error}</div>
          ))}
          {result.errors.length > 3 && (
            <div>... and {result.errors.length - 3} more errors</div>
          )}
        </div>
      )}
    </div>
  );
}
