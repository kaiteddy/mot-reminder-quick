import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Search, Mail, Phone, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import { APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { useClassicBase } from "@/lib/classicNav";

const PAGE_SIZE = 50;

export default function Customers() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const base = useClassicBase();

  // Search runs on the server, so debounce typing rather than querying per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(searchTerm.trim()); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // placeholderData keeps the previous page on screen while the next one loads — no flash
  // of "Loading" between pages or keystrokes.
  const { data, isLoading, isPlaceholderData } = trpc.customers.page.useQuery(
    { search: debounced || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    { placeholderData: (prev: any) => prev, staleTime: 30_000 },
  );
  const rows = data?.customers ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The filter narrowed under the current page — snap back to the last valid one.
  useEffect(() => { if (page > 0 && page >= pageCount) setPage(pageCount - 1); }, [page, pageCount]);

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE + rows.length);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Customers</h1>
            <p className="text-muted-foreground mt-2">
              Manage your customer database
            </p>
          </div>
        </div>

        {/* Search */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Customer List
            </CardTitle>
            <CardDescription>
              {debounced ? `${total} matching customers` : `${total} customers in database`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, phone, postcode or account number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1"
              />
            </div>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading customers...
              </div>
            ) : rows.length > 0 ? (
              <div className={`border rounded-lg overflow-hidden ${isPlaceholderData ? "opacity-60" : ""}`}>
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
                    {rows.map((customer: any) => (
                      <TableRow key={customer.id}>
                        <TableCell className="font-medium">
                          <Link href={`${base}/customers/${customer.id}`}>
                            <span className="cursor-pointer hover:underline text-blue-600">
                              {customer.name}
                            </span>
                          </Link>
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
                          <Link href={`${base}/customers/${customer.id}`}>
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
                  {debounced
                    ? "No customers found matching your search"
                    : "No customers in database"}
                </p>
                {!debounced && (
                  <p className="text-sm mt-2">
                    Import data from Garage Assistant 4 to get started
                  </p>
                )}
              </div>
            )}

            {total > 0 && (
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {from}–{to} of {total} customers
                </div>
                {pageCount > 1 && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                      <ChevronLeft className="w-4 h-4" /> Prev
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {page + 1} of {pageCount}
                    </span>
                    <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                      Next <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
