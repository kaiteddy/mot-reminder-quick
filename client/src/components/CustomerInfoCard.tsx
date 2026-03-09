import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { User, Phone, MapPin, Smartphone, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function CustomerInfoCard({ customer, vehicleId }: { customer: any, vehicleId?: number }) {
  if (!customer) return null;

  const jobSummaryUrl = vehicleId ? `${window.location.protocol}//${window.location.host}/mobile/job/${vehicleId}` : "";

  return (
    <Card className="border-2 border-primary/20 bg-primary/5">
      <CardHeader className="pb-4 flex flex-row items-center justify-between">
        <CardTitle className="text-xl flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          Customer Information
        </CardTitle>
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
      </CardHeader>
      <CardContent className="pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </CardContent>
    </Card>
  );
}
