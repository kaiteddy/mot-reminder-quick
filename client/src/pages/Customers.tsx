import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Search, Mail, Phone, MapPin } from "lucide-react";
import { APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";

export default function Customers() {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: customers, isLoading } = trpc.customers.list.useQuery();

  const filteredCustomers = customers?.filter((customer) => {
    const search = searchTerm.toLowerCase();
    return (
      customer.name?.toLowerCase().includes(search) ||
      customer.email?.toLowerCase().includes(search) ||
      customer.phone?.toLowerCase().includes(search) ||
      customer.postcode?.toLowerCase().includes(search)
    );
  }) || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Customers</h1>
            <p className="text-muted-foreground mt-2">
              Manage your customer database
            </p>
          </div>
          <Link href="/">
            <Button variant="outline">Back to Home</Button>
          </Link>
        </div>

        {/* Search */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Customer List
            </CardTitle>
            <CardDescription>
              {customers?.length || 0} customers in database
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, phone, or postcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1"
              />
            </div>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading customers...
              </div>
            ) : filteredCustomers.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCustomers.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell className="font-medium">
                          {customer.name}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 text-sm">
                            {customer.email && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Mail className="w-3 h-3" />
                                {customer.email}
                              </div>
                            )}
                            {customer.phone && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Phone className="w-3 h-3" />
                                {customer.phone}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {customer.address || customer.postcode ? (
                            <div className="text-sm text-muted-foreground">
                              <div className="flex items-start gap-1">
                                <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                <div>
                                  {customer.address && <div>{customer.address}</div>}
                                  {customer.postcode && <div className="font-medium">{customer.postcode}</div>}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {customer.notes ? (
                            <div className="text-sm text-muted-foreground max-w-xs truncate">
                              {customer.notes}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/customers/${customer.id}`}>
                            <Button variant="ghost" size="sm">
                              View Details
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>
                  {searchTerm
                    ? "No customers found matching your search"
                    : "No customers in database"}
                </p>
                {!searchTerm && (
                  <p className="text-sm mt-2">
                    Import data from Garage Assistant 4 to get started
                  </p>
                )}
              </div>
            )}

            {searchTerm && filteredCustomers.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Showing {filteredCustomers.length} of {customers?.length} customers
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
