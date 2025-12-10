import { useRoute, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  ArrowLeft, 
  Car, 
  User, 
  Phone, 
  Mail, 
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MessageSquare
} from "lucide-react";

export default function VehicleDetail() {
  const [, params] = useRoute("/vehicles/:registration");
  const registration = params?.registration || "";

  const { data: vehicle, isLoading } = trpc.vehicles.getByRegistration.useQuery(
    { registration },
    { enabled: !!registration }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="container py-8">
          <div className="text-center py-12">Loading vehicle details...</div>
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="container py-8">
          <div className="text-center py-12">
            <p className="text-lg text-muted-foreground">Vehicle not found</p>
            <Link href="/database">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Database
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-GB");
  };

  const getDaysUntilMOT = (motExpiry: Date | string | null) => {
    if (!motExpiry) return null;
    const today = new Date();
    const expiry = new Date(motExpiry);
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const daysUntilMOT = getDaysUntilMOT(vehicle.vehicle.motExpiryDate);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container py-8 space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Link href="/database">
              <Button variant="ghost" size="sm" className="mb-2">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Database
              </Button>
            </Link>
            <h1 className="text-4xl font-bold tracking-tight">
              {vehicle.vehicle.registration}
            </h1>
            <p className="text-muted-foreground mt-1">
              {vehicle.vehicle.make} {vehicle.vehicle.model}
            </p>
          </div>
          <Car className="w-16 h-16 text-blue-500 opacity-50" />
        </div>

        {/* Vehicle Details Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Car className="w-5 h-5" />
              Vehicle Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Registration</div>
              <div className="font-mono font-bold text-lg">{vehicle.vehicle.registration}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Make & Model</div>
              <div className="font-medium">{vehicle.vehicle.make} {vehicle.vehicle.model}</div>
            </div>
            {vehicle.vehicle.colour && (
              <div>
                <div className="text-sm text-muted-foreground">Colour</div>
                <div>{vehicle.vehicle.colour}</div>
              </div>
            )}
            {vehicle.vehicle.fuelType && (
              <div>
                <div className="text-sm text-muted-foreground">Fuel Type</div>
                <div>{vehicle.vehicle.fuelType}</div>
              </div>
            )}
            {vehicle.vehicle.engineCC && (
              <div>
                <div className="text-sm text-muted-foreground">Engine Size</div>
                <div>{vehicle.vehicle.engineCC}cc</div>
              </div>
            )}
            {vehicle.vehicle.vin && (
              <div className="md:col-span-2">
                <div className="text-sm text-muted-foreground">VIN</div>
                <div className="font-mono text-sm">{vehicle.vehicle.vin}</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* MOT Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              MOT Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {vehicle.vehicle.motExpiryDate ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-muted-foreground">Expiry Date</div>
                    <div className="text-2xl font-bold">{formatDate(vehicle.vehicle.motExpiryDate)}</div>
                  </div>
                  <div>
                    {daysUntilMOT !== null && (
                      <Badge
                        variant="outline"
                        className={`text-lg px-4 py-2 ${
                          daysUntilMOT < 0
                            ? "bg-red-100 text-red-700 border-red-200"
                            : daysUntilMOT <= 30
                            ? "bg-orange-100 text-orange-700 border-orange-200"
                            : "bg-green-100 text-green-700 border-green-200"
                        }`}
                      >
                        {daysUntilMOT < 0 ? (
                          <>
                            <AlertTriangle className="w-5 h-5 mr-2" />
                            Expired {Math.abs(daysUntilMOT)} days ago
                          </>
                        ) : daysUntilMOT <= 30 ? (
                          <>
                            <Clock className="w-5 h-5 mr-2" />
                            {daysUntilMOT} days left
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-5 h-5 mr-2" />
                            {daysUntilMOT} days left
                          </>
                        )}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No MOT data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Customer Information Card */}
        {vehicle.customer && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{vehicle.customer.name}</span>
              </div>
              {vehicle.customer.email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <a href={`mailto:${vehicle.customer.email}`} className="text-blue-600 hover:underline">
                    {vehicle.customer.email}
                  </a>
                </div>
              )}
              {vehicle.customer.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <a href={`tel:${vehicle.customer.phone}`} className="text-blue-600 hover:underline">
                    {vehicle.customer.phone}
                  </a>
                </div>
              )}
              <div className="pt-2">
                <Link href="/customers">
                  <Button variant="outline" size="sm">
                    View Full Customer Profile
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Reminder History Card */}
        {vehicle.reminders && vehicle.reminders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Reminder History
              </CardTitle>
              <CardDescription>
                {vehicle.reminders.length} reminder{vehicle.reminders.length > 1 ? 's' : ''} sent
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicle.reminders.map((reminder) => (
                    <TableRow key={reminder.id}>
                      <TableCell>
                        <Badge variant="outline">{reminder.type}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(reminder.dueDate)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            reminder.status === "sent"
                              ? "default"
                              : reminder.status === "archived"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {reminder.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {reminder.sentAt ? formatDate(reminder.sentAt) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
