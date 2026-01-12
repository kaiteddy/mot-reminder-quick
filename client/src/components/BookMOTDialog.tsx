import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface BookMOTDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    vehicleId: number | null;
    registration: string;
    currentExpiryDate?: Date | string | null;
    onSuccess?: () => void;
}

export function BookMOTDialog({
    open,
    onOpenChange,
    vehicleId,
    registration,
    currentExpiryDate,
    onSuccess
}: BookMOTDialogProps) {
    const [newMOTDate, setNewMOTDate] = useState("");

    // Reset/Set default date when dialog opens or vehicle changes
    useEffect(() => {
        if (open) {
            const basisDate = currentExpiryDate ? new Date(currentExpiryDate) : new Date();
            const nextYear = new Date(basisDate);
            nextYear.setFullYear(nextYear.getFullYear() + 1);
            setNewMOTDate(nextYear.toISOString().split('T')[0]);
        }
    }, [open, currentExpiryDate]);

    const utils = trpc.useUtils();

    const bookMOT = trpc.reminders.bookMOT.useMutation({
        onSuccess: () => {
            toast.success("MOT updated and reminders reset");
            onOpenChange(false);
            // Invalidate relevant queries
            utils.reminders.list.invalidate();
            utils.database.getAllVehiclesWithCustomers.invalidate();

            if (onSuccess) onSuccess();
        },
        onError: (error) => {
            toast.error(`Failed to update MOT: ${error.message}`);
        },
    });

    const handleSubmit = () => {
        if (!vehicleId || !newMOTDate) return;

        bookMOT.mutate({
            vehicleId,
            registration,
            motDate: new Date(newMOTDate).toISOString(),
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Book MOT</DialogTitle>
                    <DialogDescription>
                        Update the MOT expiry date for {registration}. This will reset current reminders.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="mot-date" className="text-right">
                            New MOT Date
                        </Label>
                        <Input
                            id="mot-date"
                            type="date"
                            className="col-span-3"
                            value={newMOTDate}
                            onChange={(e) => setNewMOTDate(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={bookMOT.isPending}>
                        {bookMOT.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Update & Book
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
