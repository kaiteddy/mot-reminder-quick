import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface MOTRefreshButtonProps {
  vehicleIds?: number[];
  limit?: number;
  label?: string;
  onComplete?: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
}

export function MOTRefreshButton({
  vehicleIds,
  limit,
  label = "Refresh MOT & Tax",
  onComplete,
  variant = "outline",
  size = "default",
  disabled = false,
}: MOTRefreshButtonProps) {
  const [progress, setProgress] = useState(0);

  const updateMutation = trpc.database.bulkUpdateMOT.useMutation({
    onSuccess: (result) => {
      // Result contains stats: { success: boolean, updated: number, failed: number, ... }
      // We can iterate or just show simple stats.
      // Based on routers.ts, database.bulkUpdateMOT returns: { success: boolean, updated: number, failed: number, skipped: number, errors: string[] }

      const { updated, failed, skipped } = result;

      if (updated > 0) {
        toast.success(`Refreshed ${updated} vehicle${updated !== 1 ? 's' : ''}`);
      }
      if (skipped > 0) {
        toast.info(`Skipped ${skipped} (up to date or invalid)`);
      }
      if (failed > 0) {
        toast.error(`Failed to refresh ${failed} vehicle${failed !== 1 ? 's' : ''}`);
      }

      setProgress(0);
      onComplete?.();
    },
    onError: (error: any) => {
      toast.error(`Refresh failed: ${error.message}`);
      setProgress(0);
    },
  });

  const handleRefresh = () => {
    if (!limit && (!vehicleIds || vehicleIds.length === 0)) {
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

    const targetCount = limit || vehicleIds?.length || 0;
    toast.info(`Refreshing data for ${targetCount} vehicle${targetCount !== 1 ? 's' : ''}...`);

    updateMutation.mutate({ vehicleIds, limit });
  };

  const isLoading = updateMutation.isPending;
  const count = limit || vehicleIds?.length || 0;

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
