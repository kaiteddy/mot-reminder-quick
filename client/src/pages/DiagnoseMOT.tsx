import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  AlertTriangle, 
  Loader2, 
  Search,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";

export default function DiagnoseMOT() {
  const { data, isLoading, refetch } = trpc.database.diagnoseNoMOT.useQuery();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-8 h-8 text-orange-500" />
              MOT Data Diagnostics
            </h1>
            <p className="text-slate-600 mt-1">Investigate vehicles without MOT expiry dates</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/database">← Back to Database</Link>
            </Button>
            <Button 
              onClick={() => refetch()}
              disabled={isLoading}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Run Diagnostics
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Summary */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Total Without MOT</CardDescription>
                <CardTitle className="text-3xl">{data.total}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Tested</CardDescription>
                <CardTitle className="text-3xl">{data.tested}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Status</CardDescription>
                <CardTitle className="text-lg">
                  {isLoading ? "Running..." : "Complete"}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Results */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnostic Results</CardTitle>
            <CardDescription>
              Testing first 20 vehicles without MOT data to identify issues
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
              </div>
            ) : data && data.diagnostics.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Registration</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Issues Found</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.diagnostics.map((diag: any) => (
                    <TableRow key={diag.id}>
                      <TableCell className="font-mono font-semibold">
                        {diag.registration || <span className="text-slate-400">No registration</span>}
                      </TableCell>
                      <TableCell>
                        {diag.make || diag.model ? (
                          <div>
                            <div className="font-medium">{diag.make || "Unknown"}</div>
                            <div className="text-sm text-slate-500">{diag.model || ""}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">No vehicle data</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {diag.issues.map((issue: string, idx: number) => (
                            <div key={idx} className="text-sm">
                              {issue.includes("needs database update") ? (
                                <Badge variant="default" className="bg-green-500">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  {issue}
                                </Badge>
                              ) : issue.includes("Invalid") || issue.includes("error") ? (
                                <Badge variant="destructive">
                                  <XCircle className="w-3 h-3 mr-1" />
                                  {issue}
                                </Badge>
                              ) : (
                                <Badge variant="secondary">
                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                  {issue}
                                </Badge>
                              )}
                            </div>
                          ))}
                          {diag.motExpiryDate && (
                            <div className="text-xs text-green-600 mt-1">
                              MOT Expiry: {new Date(diag.motExpiryDate).toLocaleDateString("en-GB")}
                            </div>
                          )}
                          {diag.dvlaData && (
                            <div className="text-xs text-slate-500 mt-1">
                              DVLA: {diag.dvlaData.make} {diag.dvlaData.model} 
                              {diag.dvlaData.yearOfManufacture && ` (${diag.dvlaData.yearOfManufacture})`}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {diag.issues.some((i: string) => i.includes("needs database update")) ? (
                          <Badge variant="default" className="bg-green-500">Fixable</Badge>
                        ) : diag.issues.some((i: string) => i.includes("Invalid") || i.includes("error")) ? (
                          <Badge variant="destructive">Error</Badge>
                        ) : (
                          <Badge variant="secondary">No Data</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12 text-slate-500">
                Click "Run Diagnostics" to start investigation
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recommendations */}
        {data && data.diagnostics.length > 0 && (
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="text-blue-900">Recommendations</CardTitle>
            </CardHeader>
            <CardContent className="text-blue-800">
              <ul className="list-disc list-inside space-y-2">
                {data.diagnostics.some((d: any) => d.issues.some((i: string) => i.includes("needs database update"))) && (
                  <li>
                    <strong>Run Bulk MOT Check:</strong> Some vehicles have MOT data available in DVLA API but not in database. 
                    Go to <Link href="/database" className="underline">Database Overview</Link> and click "Bulk MOT Check" to update.
                  </li>
                )}
                {data.diagnostics.some((d: any) => d.issues.some((i: string) => i.includes("Invalid"))) && (
                  <li>
                    <strong>Fix Invalid Registrations:</strong> Some vehicles have invalid UK registration formats. 
                    Check and correct these in the <Link href="/vehicles" className="underline">Vehicles page</Link>.
                  </li>
                )}
                {data.diagnostics.some((d: any) => d.issues.some((i: string) => i.includes("No registration"))) && (
                  <li>
                    <strong>Add Missing Registrations:</strong> Some vehicles don't have registration numbers. 
                    Update them in the <Link href="/vehicles" className="underline">Vehicles page</Link>.
                  </li>
                )}
                {data.diagnostics.some((d: any) => d.issues.some((i: string) => i.includes("exempt or too new"))) && (
                  <li>
                    <strong>MOT Exempt Vehicles:</strong> Some vehicles may be exempt from MOT (e.g., vehicles under 3 years old, 
                    historic vehicles over 40 years old, or certain vehicle types).
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
