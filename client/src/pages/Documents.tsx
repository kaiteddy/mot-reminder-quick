import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

const TYPE_LABEL: Record<string, string> = {
  SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note",
  XS: "Excess", PA: "Payment", VS: "Vehicle Sale", VP: "Vehicle Purchase",
};
const TYPE_COLOR: Record<string, string> = {
  SI: "bg-green-100 text-green-800", ES: "bg-blue-100 text-blue-800",
  JS: "bg-amber-100 text-amber-800", CR: "bg-red-100 text-red-800",
};
const FILTERS = [
  { key: "all", label: "All" },
  { key: "SI", label: "Invoices" },
  { key: "ES", label: "Estimates" },
  { key: "JS", label: "Job Sheets" },
  { key: "CR", label: "Credit Notes" },
];

const money = (v: string | number | null) =>
  v == null ? "-" : `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");

export default function Documents() {
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState("all");
  const [, setLocation] = useLocation();

  const { data: stats } = trpc.documents.stats.useQuery();
  const { data: docs, isLoading } = trpc.documents.list.useQuery({ search, docType, limit: 200 });

  const typeCount = (code: string) => stats?.byType.find((t) => t.docType === code)?.n ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Documents</h1>
            <p className="text-muted-foreground mt-2">
              Job sheets, invoices, estimates &amp; credit notes
            </p>
          </div>
          <Button onClick={() => setLocation("/documents/new")} className="gap-2">
            <FileText className="w-4 h-4" /> New Job Sheet
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total" value={stats?.total} />
          <StatCard label="Invoices" value={typeCount("SI")} />
          <StatCard label="Estimates" value={typeCount("ES")} />
          <StatCard label="Job Sheets" value={typeCount("JS")} />
          <StatCard label="Credit Notes" value={typeCount("CR")} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" /> Document List
            </CardTitle>
            <CardDescription>Search by document number, registration, or customer</CardDescription>
            <div className="flex flex-col sm:flex-row gap-3 pt-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search documents…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {FILTERS.map((f) => (
                  <Button
                    key={f.key}
                    variant={docType === f.key ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDocType(f.key)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doc No</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  )}
                  {!isLoading && (docs?.length ?? 0) === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No documents found</TableCell></TableRow>
                  )}
                  {docs?.map((d: any) => (
                    <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/documents/${d.id}`)}>
                      <TableCell className="font-medium">{d.docNo || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={TYPE_COLOR[d.docType] || ""}>
                          {TYPE_LABEL[d.docType] || d.docType || "?"}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtDate(d.dateIssued || d.dateCreated)}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{d.customerName || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <span className="font-mono">{d.registration || "—"}</span>
                        {d.make && <span className="text-muted-foreground text-xs ml-1">{d.make} {d.model}</span>}
                      </TableCell>
                      <TableCell className="text-right">{money(d.totalGross)}</TableCell>
                      <TableCell className="text-right">
                        {d.balance != null && Number(d.balance) > 0
                          ? <span className="text-red-600 font-medium">{money(d.balance)}</span>
                          : money(d.balance)}
                      </TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{d.docStatus || "-"}</span></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {(docs?.length ?? 0) >= 200 && (
              <p className="text-xs text-muted-foreground mt-3">Showing first 200 — refine your search to narrow results.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-bold">{value?.toLocaleString("en-GB") ?? "—"}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
