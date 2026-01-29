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
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Trash2, RefreshCw } from "lucide-react";
import { useState } from "react";

export default function DiagnoseMOT() {
  const [isProcessing, setIsProcessing] = useState(false);
  const { data, isLoading, refetch } = trpc.database.diagnoseNoMOT.useQuery();

  const utils = trpc.useUtils();

  const bulkDelete = trpc.database.deleteCategorizedVehicles.useMutation({
    onSuccess: (res) => {
      toast.success("Cleanup Complete", {
        description: `Deleted ${res.deletedCount} vehicles. Skipped ${res.skippedCount} with reminder history.`,
      });
      refetch();
    },
    onError: (err) => {
      toast.error("Cleanup Failed", {
        description: err.message,
      });
    }
  });

  const bulkVerify = trpc.database.bulkUpdateMOT.useMutation({
    onSuccess: (res) => {
      toast.success("Bulk Verify Complete", {
        description: `Updated ${res.updated} vehicles, ${res.failed} failed, ${res.skipped} skipped.`,
      });
      refetch();
    },
    onError: (err) => {
      toast.error("Bulk Verify Failed", {
        description: err.message,
      });
    },
    onSettled: () => setIsProcessing(false),
  });

  const handleBulkDelete = async (category: 'invalid' | 'missing' | 'scrapped') => {
    if (!data?.categoryIds[category]?.length) return;

    bulkDelete.mutate({
      vehicleIds: data.categoryIds[category],
      skipIfHistoryExists: true,
    });
  };

  const handleBulkVerify = async () => {
    if (!data?.categoryIds.neverChecked?.length) return;

    setIsProcessing(true);
    bulkVerify.mutate({
      vehicleIds: data.categoryIds.neverChecked,
    });
  };

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

        {/* Summary & Bulk Actions */}
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <Card>
                <CardHeader className="p-4">
                  <CardDescription className="text-xs">Total Missing MOT</CardDescription>
                  <CardTitle className="text-2xl">{data.total}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader className="p-4">
                  <CardDescription className="text-xs text-orange-700">Valid UK (Never Checked)</CardDescription>
                  <CardTitle className="text-2xl text-orange-900">{data.summary.validUKNeverChecked}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="border-red-200 bg-red-50">
                <CardHeader className="p-4">
                  <CardDescription className="text-xs text-red-700">Invalid Formats</CardDescription>
                  <CardTitle className="text-2xl text-red-900">{data.summary.invalidFormat}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="p-4">
                  <CardDescription className="text-xs">Checked (No Data)</CardDescription>
                  <CardTitle className="text-2xl">{data.summary.validUKCheckedNoData}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="p-4">
                  <CardDescription className="text-xs">Too New / Irish</CardDescription>
                  <CardTitle className="text-2xl">{data.summary.tooNew + data.summary.irish}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="p-4">
                  <CardDescription className="text-xs">Status</CardDescription>
                  <CardTitle className="text-lg">
                    {isLoading || isProcessing ? "Working..." : "Complete"}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <div className="flex flex-wrap gap-4">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    className="gap-2"
                    disabled={!data?.categoryIds.invalid.length || bulkDelete.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    Clean Up Invalid ({data?.summary.invalidFormat})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete all vehicles with invalid registration formats.
                      Vehicles with existing reminder logs or history will be automatically skipped for safety.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleBulkDelete('invalid')}>
                      Delete Invalid
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    className="gap-2"
                    disabled={!data?.categoryIds.scrapped.length || bulkDelete.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    Archive Scrapped ({data?.summary.validUKCheckedNoData})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive Scrapped Vehicles?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete vehicles that have been checked but not found in the DVLA database.
                      Safety check: vehicles with reminder history will be skipped.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleBulkDelete('scrapped')}>
                      Delete Scrapped
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Button
                variant="secondary"
                className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleBulkVerify}
                disabled={!data?.categoryIds.neverChecked.length || isProcessing}
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Verify Never Checked ({data?.summary.validUKNeverChecked})
              </Button>
            </div>
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
                {data.summary.validUKNeverChecked > 0 && (
                  <li>
                    <strong>Run Bulk MOT Check (Highly Recommended):</strong> You have {data.summary.validUKNeverChecked} vehicles with valid UK registration formats that haven't been checked yet.
                    This will likely find MOT dates for many of them. Use the "Bulk MOT Check" button on the <Link href="/database" className="underline">Database page</Link>.
                  </li>
                )}
                {data.summary.invalidFormat > 0 && (
                  <li>
                    <strong>Clean Up Invalid Formats:</strong> {data.summary.invalidFormat} vehicles have registrations like "SAAB" or "MICRA".
                    These are likely data import errors. You can safely delete these vehicles if they have no reminder history,
                    or correct them in the <Link href="/vehicles" className="underline">Vehicles page</Link>.
                  </li>
                )}
                {data.summary.validUKCheckedNoData > 0 && (
                  <li>
                    <strong>Scrapped Vehicles:</strong> {data.summary.validUKCheckedNoData} vehicles were checked but not found in the DVLA database.
                    These are likely scrapped or very old historical records. You may want to archive or remove them.
                  </li>
                )}
                {data.summary.irish > 0 && (
                  <li>
                    <strong>Irish Vehicles:</strong> {data.summary.irish} vehicles have Irish registration formats.
                    The UK DVLA Enquiry API does not support these. You must provide their MOT dates manually.
                  </li>
                )}
                {data.summary.tooNew > 0 && (
                  <li>
                    <strong>New Vehicles:</strong> {data.summary.tooNew} vehicles are less than 3 years old (2022+ plates).
                    They won't appear in MOT searches until their 3rd anniversary.
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
