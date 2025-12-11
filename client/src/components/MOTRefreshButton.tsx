import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface MOTRefreshButtonProps {
  registrations: string[];
  label?: string;
  onComplete?: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
}

export function MOTRefreshButton({
  registrations,
  label = "Refresh MOT Data",
  onComplete,
  variant = "outline",
  size = "default",
  disabled = false,
}: MOTRefreshButtonProps) {
  const [progress, setProgress] = useState(0);
  
  const verifyMutation = trpc.reminders.bulkVerifyMOT.useMutation({
    onSuccess: (results) => {
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      if (successful > 0) {
        toast.success(`MOT data refreshed for ${successful} vehicle${successful !== 1 ? 's' : ''}`);
      }
      if (failed > 0) {
        toast.error(`Failed to refresh ${failed} vehicle${failed !== 1 ? 's' : ''}`);
      }
      
      setProgress(0);
      onComplete?.();
    },
    onError: (error) => {
      toast.error(`MOT refresh failed: ${error.message}`);
      setProgress(0);
    },
  });

  const handleRefresh = () => {
    if (registrations.length === 0) {
      toast.error("No vehicles to refresh");
      return;
    }

    // Start progress simulation
    setProgress(0);
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) {
          clearInterval(interval);
          return 95;
        }
        return prev + 5;
      });
    }, 200);

    toast.info(`Refreshing MOT data for ${registrations.length} vehicle${registrations.length !== 1 ? 's' : ''}...`);
    
    verifyMutation.mutate({ registrations });
  };

  const isLoading = verifyMutation.isPending;
  const count = registrations.length;

  return (
    <Button
      onClick={handleRefresh}
      disabled={disabled || isLoading || count === 0}
      variant={variant}
      size={size}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
      {isLoading ? (
        <>
          {label} ({progress}%)
        </>
      ) : (
        <>
          {label} {count > 0 && `(${count})`}
        </>
      )}
    </Button>
  );
}
