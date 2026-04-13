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
  const [progress, setProgress] = useState<{ current: number, total: number } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const updateMutation = trpc.database.bulkUpdateMOT.useMutation();

  const handleRefresh = async () => {
    if (!limit && (!vehicleIds || vehicleIds.length === 0)) {
      toast.error("No vehicles to refresh");
      return;
    }

    setIsUpdating(true);
    let totalUpdated = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    try {
      if (vehicleIds && vehicleIds.length > 0) {
        setProgress({ current: 0, total: vehicleIds.length });
        const chunkSize = 5;
        for (let i = 0; i < vehicleIds.length; i += chunkSize) {
          const chunk = vehicleIds.slice(i, i + chunkSize);
          const res = await updateMutation.mutateAsync({ vehicleIds: chunk });
          totalUpdated += res.updated;
          totalFailed += res.failed;
          totalSkipped += res.skipped;
          setProgress({ current: Math.min(i + chunkSize, vehicleIds.length), total: vehicleIds.length });
        }
      } else {
        const res = await updateMutation.mutateAsync({ limit });
        totalUpdated += res.updated;
        totalFailed += res.failed;
        totalSkipped += res.skipped;
      }

      const totalCount = limit || vehicleIds?.length || 0;
      toast.success("MOT Check Complete", {
        description: `Updated ${totalUpdated} vehicles, ${totalFailed} failed, ${totalSkipped} skipped.`
      });
    } catch (e: any) {
      toast.error(`Refresh failed: ${e.message}`);
    }

    setProgress(null);
    setIsUpdating(false);
    onComplete?.();
  };

  const count = limit || vehicleIds?.length || 0;

  return (
    <Button
      onClick={handleRefresh}
      disabled={disabled || isUpdating || count === 0}
      variant={variant}
      size={size}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isUpdating ? 'animate-spin' : ''}`} />
      {isUpdating && progress ? (
        <>
          {label} ({progress.current}/{progress.total})
        </>
      ) : isUpdating ? (
        <>
          {label}...
        </>
      ) : (
        <>
          {label} {count > 0 && `(${count})`}
        </>
      )}
    </Button>
  );
}
