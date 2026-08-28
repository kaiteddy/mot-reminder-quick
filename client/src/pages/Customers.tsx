import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Search, Mail, Phone, Smartphone, MapPin, ChevronLeft, ChevronRight, Building2, StickyNote } from "lucide-react";
import { APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { useClassicBase } from "@/lib/classicNav";

const PAGE_SIZE = 50;

/** GA4 crams person and company into one name field ("Mr X C/O Company Ltd", or just a company
 * name). Split them for display only — the record itself is untouched. Calibrated against the
 * live data: a corporate suffix always means a company (even "Mr Baker Limited"), softer trade
 * words only count when the name has no personal title in front. */
const STRONG_CO = /\b(ltd|limited|plc|llp|inc)\b\.?/i;
const WEAK_CO = /\b(company|motors|garage|garages|services|group|solutions|logistics|foods|properties|estates|holdings|consulting|rentals|hire|taxis|cars|autos|motorcare|council|school|church|charity|club|centre|center|insurance)\b/i;
const TITLED = /^(mr|mrs|miss|ms|dr|prof)\b/i;
function splitNameCompany(raw?: string | null): { person: string; company: string } {
  const name = (raw || "").trim();
  const co = name.split(/\bc\/o\b/i);
  if (co.length === 2) return { person: co[0].replace(/[()]/g, "").trim(), company: co[1].trim() };
  if (STRONG_CO.test(name) || (!TITLED.test(name) && WEAK_CO.test(name))) return { person: "", company: name };
  return { person: name, company: "" };
}

/** UK mobile vs landline, however the number is stored (07…, +447…, 447…). */
function isUkMobile(phone?: string | null): boolean {
  const d = String(phone || "").replace(/\D/g, "");
  return /^(44)?0?7\d{9}$/.test(d);
}

function mapsUrl(address?: string | null, postcode?: string | null): string {
  return `https://maps.google.com/?q=${encodeURIComponent([address, postcode].filter(Boolean).join(", "))}`;
}

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
              <div className={`border rounded-lg overflow-x-auto ${isPlaceholderData ? "opacity-60" : ""}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="min-w-[180px]">Customer</TableHead>
                      <TableHead className="min-w-[160px]">Company</TableHead>
                      <TableHead className="min-w-[150px]">Phone / Mobile</TableHead>
                      <TableHead className="min-w-[190px]">Email</TableHead>
                      <TableHead className="min-w-[220px]">Address</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((customer: any) => {
                      const { person, company } = splitNameCompany(customer.name);
                      const mobile = isUkMobile(customer.phone);
                      const hasAddress = !!(customer.address || customer.postcode);
                      return (
                        <TableRow key={customer.id} className="hover:bg-muted/30">
                          <TableCell className="py-3">
                            <div className="flex items-center gap-1.5">
                              <Link href={`${base}/customers/${customer.id}`}>
                                <span className="cursor-pointer hover:underline text-blue-600 font-semibold">
                                  {person || (company ? <span className="text-muted-foreground font-normal italic">(company account)</span> : customer.name || "—")}
                                </span>
                              </Link>
                              {customer.notes && (
                                <span title={customer.notes}>
                                  <StickyNote className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                </span>
                              )}
                            </div>
                            {customer.accountNumber && (
                              <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{customer.accountNumber}</div>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            {company ? (
                              <div className="flex items-center gap-1.5 text-sm">
                                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span>{company}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            {customer.phone ? (
                              <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 text-sm hover:underline whitespace-nowrap">
                                {mobile
                                  ? <Smartphone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  : <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                                {customer.phone}
                              </a>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            {customer.email && customer.email.includes("@") ? (
                              <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 text-sm hover:underline">
                                <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span className="truncate max-w-[220px]">{customer.email}</span>
                              </a>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            {hasAddress ? (
                              <a
                                href={mapsUrl(customer.address, customer.postcode)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open in Google Maps"
                                className="flex items-start gap-1.5 text-sm group"
                              >
                                <MapPin className="w-3.5 h-3.5 mt-0.5 text-red-500 shrink-0 group-hover:scale-110 transition-transform" />
                                <span className="group-hover:underline">
                                  {customer.address && <span>{customer.address}</span>}
                                  {customer.address && customer.postcode && <span>, </span>}
                                  {customer.postcode && <span className="font-semibold whitespace-nowrap">{customer.postcode}</span>}
                                </span>
                              </a>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right py-3">
                            <Link href={`${base}/customers/${customer.id}`}>
                              <Button variant="ghost" size="sm">
                                View Details
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
