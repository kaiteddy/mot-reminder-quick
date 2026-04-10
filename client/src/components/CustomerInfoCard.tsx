import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { User, Phone, MapPin, Smartphone, Copy, Edit, Loader2, Search, ArrowLeftRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

function AssignCustomerDialog({ vehicleId, triggerButton }: { vehicleId: number; triggerButton: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  
  const { data: customers = [], isLoading } = trpc.customers.list.useQuery(undefined, {
    enabled: open
  });
  
  const assignMutation = trpc.reminders.assignVehicle.useMutation({
    onSuccess: () => {
      toast.success("Vehicle successfully assigned to customer.");
      setOpen(false);
      setTimeout(() => window.location.reload(), 1000);
    },
    onError: (err) => {
      toast.error("Failed to assign customer: " + err.message);
    }
  });

  const filtered = customers.filter(c => 
    (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone || '').includes(searchTerm) ||
    (c.email || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Assign Customer</DialogTitle>
          <DialogDescription>
            Search for an existing customer in the system to link to this vehicle.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by name, phone or email..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="border rounded-md divide-y max-h-[300px] overflow-y-auto">
             {isLoading ? <div className="p-4 text-center">Loading customers...</div> : 
              filtered.length === 0 ? <div className="p-4 text-center text-muted-foreground">No matching customers found.</div> :
              filtered.map(c => (
                <div key={c.id} className="p-3 flex justify-between items-center hover:bg-slate-50 transition-colors">
                  <div>
                    <div className="font-semibold text-sm">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.phone || 'No phone'} | {c.email || 'No email'}</div>
                  </div>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    disabled={assignMutation.isPending}
                    onClick={() => assignMutation.mutate({ vehicleId, customerId: c.id })}
                  >
                    Select
                  </Button>
                </div>
              ))
             }
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerInfoCard({ customer, vehicleId }: { customer: any, vehicleId?: number }) {
  const [editOpen, setEditOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: customer?.name || "",
    phone: customer?.phone || "",
    email: customer?.email || "",
    address: customer?.address || "",
    postcode: customer?.postcode || ""
  });

  const unlinkMutation = trpc.reminders.unlinkVehicle.useMutation({
    onSuccess: () => {
      toast.success("Vehicle securely unlinked from customer.");
      setTimeout(() => window.location.reload(), 1000);
    },
    onError: () => {
      toast.error("Failed to unlink vehicle.");
    }
  });

  const updateMutation = trpc.customers.update.useMutation({
    onSuccess: () => {
      toast.success("Customer details updated successfully.");
      setEditOpen(false);
      setTimeout(() => window.location.reload(), 1000);
    },
    onError: (err) => {
      toast.error("Failed to update customer: " + err.message);
    }
  });

  if (!customer) {
    if (!vehicleId) return null;
    return (
      <Card className="border-2 border-dashed border-slate-200 bg-slate-50/50">
        <CardContent className="py-8 flex flex-col items-center justify-center text-center">
          <User className="h-10 w-10 text-slate-300 mb-3" />
          <h3 className="font-semibold text-slate-700 text-lg">No Customer Assigned</h3>
          <p className="text-sm text-slate-500 mb-4 max-w-sm">
            This vehicle does not currently have an owner on file. Assign an existing customer to manage MOT reminders and jobs.
          </p>
          <AssignCustomerDialog 
            vehicleId={vehicleId} 
            triggerButton={
              <Button>Assign Owner</Button>
            } 
          />
        </CardContent>
      </Card>
    );
  }

  const jobSummaryUrl = vehicleId ? `${window.location.protocol}//${window.location.host}/mobile/job/${vehicleId}` : "";

  return (
    <Card className="border-2 border-primary/20 bg-primary/5">
      <CardHeader className="pb-4 flex flex-row items-center justify-between">
        <CardTitle className="text-xl flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          Customer Information
        </CardTitle>
        <div className="flex items-center gap-2">
          {vehicleId && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="bg-white hover:bg-slate-100">
                  <Smartphone className="w-4 h-4 mr-2 text-primary" />
                  Portal Link
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md text-center flex flex-col items-center">
                <DialogHeader>
                  <DialogTitle className="text-center">Mobile Job Summary</DialogTitle>
                  <DialogDescription className="text-center">
                    Scan this QR code with your phone camera to instantly open the customer's portal for this vehicle.
                  </DialogDescription>
                </DialogHeader>
                <div className="p-6 bg-white rounded-xl shadow-inner border border-slate-100 flex items-center justify-center">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(jobSummaryUrl)}`}
                    alt="QR Code"
                    className="w-48 h-48 pointer-events-none"
                  />
                </div>
                <div className="flex w-full gap-2 mt-4">
                  <Button
                    onClick={() => {
                      navigator.clipboard.writeText(jobSummaryUrl);
                      toast.success("Mobile link copied to clipboard");
                    }}
                    variant="outline"
                    className="flex-1"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Link
                  </Button>
                  <Button
                    onClick={() => {
                      window.open(`sms:${customer.phone || ''}?&body=${encodeURIComponent(`Your Vehicle Portal: ${jobSummaryUrl}`)}`, '_blank');
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                  >
                    <Smartphone className="w-4 h-4 mr-2 text-white" />
                    <span className="text-white">Send SMS</span>
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}

          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="bg-white hover:bg-slate-100">
                <Edit className="w-4 h-4 mr-2 text-primary" />
                Edit
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Edit Customer</DialogTitle>
                <DialogDescription>
                  Update the contact information for this customer below.
                </DialogDescription>
              </DialogHeader>
              <form 
                className="space-y-4 pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateMutation.mutate({
                    id: customer.id,
                    ...formData
                  });
                }}
              >
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input 
                    value={formData.name} 
                    onChange={e => setFormData(f => ({...f, name: e.target.value}))}
                    placeholder="E.g. John Smith"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input 
                    value={formData.phone} 
                    onChange={e => setFormData(f => ({...f, phone: e.target.value}))}
                    placeholder="E.g. 07700 900077"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input 
                    type="email"
                    value={formData.email} 
                    onChange={e => setFormData(f => ({...f, email: e.target.value}))}
                    placeholder="Email address"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input 
                    value={formData.address} 
                    onChange={e => setFormData(f => ({...f, address: e.target.value}))}
                    placeholder="Full address (e.g. 123 High St)"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Postcode</Label>
                  <Input 
                    value={formData.postcode} 
                    onChange={e => setFormData(f => ({...f, postcode: e.target.value}))}
                    placeholder="e.g. SW1A 1AA"
                    className="uppercase"
                  />
                </div>
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={updateMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
                    {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="pt-0 grid grid-cols-1 md:grid-cols-2 gap-4 relative pb-6">
        <div>
          <h4 className="font-semibold text-lg">{customer.name}</h4>
          {customer.phone && (
            <div className="flex items-center gap-2 text-muted-foreground mt-2">
              <Phone className="h-4 w-4" />
              <span>{customer.phone}</span>
            </div>
          )}
        </div>
        <div>
          <div className="flex items-start gap-2 text-muted-foreground mt-2">
            <MapPin className="h-4 w-4 mt-1" />
            <div className="text-sm">
              {customer.address || "No address on file"}
            </div>
          </div>
        </div>
        {vehicleId && (
          <div className="absolute bottom-2 right-4 flex gap-2">
            <AssignCustomerDialog 
              vehicleId={vehicleId}
              triggerButton={
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <ArrowLeftRight className="w-3 h-3 mr-1.5" />
                  Change Owner
                </Button>
              }
            />
            <Button
              variant="outline"
              size="sm"
              className="text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                if (window.confirm(`Are you sure you want to unlink this vehicle from ${customer.name}? This will prevent reminders from going to the wrong person.`)) {
                  unlinkMutation.mutate({ vehicleId });
                }
              }}
              disabled={unlinkMutation.isPending}
            >
              {unlinkMutation.isPending ? "Unlinking..." : "Unlink Owner"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
