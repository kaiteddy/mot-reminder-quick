import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Search } from "lucide-react";
import type { Reminder } from "../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface EditReminderDialogProps {
  reminder: Reminder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditReminderDialog({ reminder, open, onOpenChange, onSuccess }: EditReminderDialogProps) {
  const [formData, setFormData] = useState({
    type: reminder.type,
    dueDate: new Date(reminder.dueDate).toISOString().split('T')[0],
    registration: reminder.registration,
    customerName: reminder.customerName || "",
    customerEmail: reminder.customerEmail || "",
    customerPhone: reminder.customerPhone || "",
    vehicleMake: reminder.vehicleMake || "",
    vehicleModel: reminder.vehicleModel || "",
    status: reminder.status,
    notes: reminder.notes || "",
  });

  const [isLookingUp, setIsLookingUp] = useState(false);

  const updateMutation = trpc.reminders.update.useMutation({
    onSuccess: () => {
      toast.success("Reminder updated successfully");
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const lookupMutation = trpc.reminders.lookupMOT.useMutation({
    onSuccess: (data) => {
      setFormData(prev => ({
        ...prev,
        vehicleMake: data.make || prev.vehicleMake,
        vehicleModel: data.model || prev.vehicleModel,
        dueDate: data.motExpiryDate ? new Date(data.motExpiryDate).toISOString().split('T')[0] : prev.dueDate,
      }));
      toast.success("Vehicle details updated from MOT API");
      setIsLookingUp(false);
    },
    onError: (error: any) => {
      toast.error(error.message);
      setIsLookingUp(false);
    },
  });

  const handleLookup = () => {
    if (!formData.registration) {
      toast.error("Please enter a registration number");
      return;
    }
    setIsLookingUp(true);
    lookupMutation.mutate({ registration: formData.registration });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: reminder.id,
      ...formData,
    });
  };

  // Reset form when reminder changes
  useEffect(() => {
    setFormData({
      type: reminder.type,
      dueDate: new Date(reminder.dueDate).toISOString().split('T')[0],
      registration: reminder.registration,
      customerName: reminder.customerName || "",
      customerEmail: reminder.customerEmail || "",
      customerPhone: reminder.customerPhone || "",
      vehicleMake: reminder.vehicleMake || "",
      vehicleModel: reminder.vehicleModel || "",
      status: reminder.status,
      notes: reminder.notes || "",
    });
  }, [reminder]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Reminder</DialogTitle>
          <DialogDescription>
            Update reminder details or look up vehicle information from MOT API
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value: "MOT" | "Service") => setFormData(prev => ({ ...prev, type: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
            <SelectContent>
              <SelectItem value="MOT">MOT</SelectItem>
              <SelectItem value="Service">Service</SelectItem>
              <SelectItem value="Cambelt">Cambelt</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date</Label>
              <Input
                id="dueDate"
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="registration">Registration</Label>
            <div className="flex gap-2">
              <Input
                id="registration"
                value={formData.registration}
                onChange={(e) => setFormData(prev => ({ ...prev, registration: e.target.value.toUpperCase() }))}
                placeholder="AB12 CDE"
                required
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleLookup}
                disabled={isLookingUp}
              >
                {isLookingUp ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Lookup
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vehicleMake">Vehicle Make</Label>
              <Input
                id="vehicleMake"
                value={formData.vehicleMake}
                onChange={(e) => setFormData(prev => ({ ...prev, vehicleMake: e.target.value }))}
                placeholder="e.g., Ford"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vehicleModel">Vehicle Model</Label>
              <Input
                id="vehicleModel"
                value={formData.vehicleModel}
                onChange={(e) => setFormData(prev => ({ ...prev, vehicleModel: e.target.value }))}
                placeholder="e.g., Focus"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customerName">Customer Name</Label>
            <Input
              id="customerName"
              value={formData.customerName}
              onChange={(e) => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
              placeholder="John Smith"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customerEmail">Customer Email</Label>
              <Input
                id="customerEmail"
                type="email"
                value={formData.customerEmail}
                onChange={(e) => setFormData(prev => ({ ...prev, customerEmail: e.target.value }))}
                placeholder="john@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customerPhone">Customer Phone</Label>
              <Input
                id="customerPhone"
                type="tel"
                value={formData.customerPhone}
                onChange={(e) => setFormData(prev => ({ ...prev, customerPhone: e.target.value }))}
                placeholder="+447123456789"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value: "pending" | "sent" | "archived") => setFormData(prev => ({ ...prev, status: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional notes..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
