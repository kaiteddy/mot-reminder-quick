import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { User, Phone, MapPin, Wrench } from "lucide-react";

export function CustomerInfoCard({ customer }: { customer: any }) {
  if (!customer) return null;

  return (
    <Card className="border-2 border-primary/20 bg-primary/5">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          Customer Information
        </CardTitle>
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
