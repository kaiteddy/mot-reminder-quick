import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface MOTRefreshButtonLiveProps {
  registrations: string[];
  label?: string;
  onComplete?: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
}

interface VehicleUpdate {
  registration: string;
  status: "pending" | "processing" | "success" | "failed";
  message?: string;
  motExpiryDate?: string;
}

export function MOTRefreshButtonLive({
  registrations,
  label = "Refresh MOT Data",
  onComplete,
  variant = "outline",
  size = "default",
  disabled = false,
}: MOTRefreshButtonLiveProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [vehicleUpdates, setVehicleUpdates] = useState<VehicleUpdate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const utils = trpc.useUtils();
  
  const verifyMutation = trpc.reminders.bulkVerifyMOT.useMutation({
    onSuccess: (results) => {
      // Update all vehicles with final status
      const updates: VehicleUpdate[] = results.map(r => ({
        registration: r.registration,
        status: r.success ? "success" : "failed",
        message: r.success ? `MOT expires ${new Date(r.motExpiryDate || '').toLocaleDateString('en-GB')}` : r.error,
        motExpiryDate: r.motExpiryDate,
      }));
      
      setVehicleUpdates(updates);
      setCurrentIndex(results.length);
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      if (successful > 0) {
        toast.success(`MOT data refreshed for ${successful} vehicle${successful !== 1 ? 's' : ''}`);
      }
      if (failed > 0) {
        toast.error(`Failed to refresh ${failed} vehicle${failed !== 1 ? 's' : ''}`);
      }
      
      // Refresh the data
      onComplete?.();
    },
    onError: (error) => {
      toast.error(`MOT refresh failed: ${error.message}`);
      setShowDialog(false);
      setVehicleUpdates([]);
      setCurrentIndex(0);
    },
  });

  const handleRefresh = async () => {
    if (registrations.length === 0) {
      toast.error("No vehicles to refresh");
      return;
    }

    // Initialize all vehicles as pending
    const initialUpdates: VehicleUpdate[] = registrations.map(reg => ({
      registration: reg,
      status: "pending",
    }));
    
    setVehicleUpdates(initialUpdates);
    setCurrentIndex(0);
    setShowDialog(true);
    
    toast.info(`Starting MOT refresh for ${registrations.length} vehicle${registrations.length !== 1 ? 's' : ''}...`);
    
    // Start the mutation
    verifyMutation.mutate({ registrations });
    
    // Simulate progress updates (since backend processes synchronously)
    const progressInterval = setInterval(() => {
      setCurrentIndex(prev => {
        if (prev < registrations.length && verifyMutation.isPending) {
          // Update current vehicle to processing
          setVehicleUpdates(updates => 
            updates.map((u, i) => 
              i === prev ? { ...u, status: "processing" } : u
            )
          );
          return prev + 1;
        }
        clearInterval(progressInterval);
        return prev;
      });
    }, 800); // Update every 800ms to show progress
  };

  const isLoading = verifyMutation.isPending;
  const count = registrations.length;
  const completed = vehicleUpdates.filter(v => v.status === "success" || v.status === "failed").length;

  return (
    <>
      <Button
        onClick={handleRefresh}
        disabled={disabled || isLoading || count === 0}
        variant={variant}
        size={size}
      >
        <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
        {isLoading ? (
          <>
            {label} ({currentIndex}/{count})
          </>
        ) : (
          <>
            {label} {count > 0 && `(${count})`}
          </>
        )}
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>MOT Data Refresh Progress</DialogTitle>
            <DialogDescription>
              {isLoading ? (
                `Processing ${currentIndex} of ${count} vehicles...`
              ) : (
                `Completed: ${completed} of ${count} vehicles`
              )}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
              {vehicleUpdates.map((vehicle, index) => (
                <div
                  key={vehicle.registration}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    vehicle.status === "success" ? "bg-green-50 border-green-200" :
                    vehicle.status === "failed" ? "bg-red-50 border-red-200" :
                    vehicle.status === "processing" ? "bg-blue-50 border-blue-200" :
                    "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="font-mono font-bold text-sm">
                      {vehicle.registration}
                    </div>
                    {vehicle.status === "success" && (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    )}
                    {vehicle.status === "failed" && (
                      <XCircle className="w-4 h-4 text-red-600" />
                    )}
                    {vehicle.status === "processing" && (
                      <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                    )}
                  </div>
                  
                  <div className="text-sm text-slate-600">
                    {vehicle.status === "pending" && (
                      <Badge variant="secondary">Waiting</Badge>
                    )}
                    {vehicle.status === "processing" && (
                      <Badge variant="default" className="bg-blue-600">Processing...</Badge>
                    )}
                    {vehicle.status === "success" && (
                      <span className="text-green-700">{vehicle.message}</span>
                    )}
                    {vehicle.status === "failed" && (
                      <span className="text-red-700">{vehicle.message || "Failed"}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={isLoading}
            >
              {isLoading ? "Processing..." : "Close"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
