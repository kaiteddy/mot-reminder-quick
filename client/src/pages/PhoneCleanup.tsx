import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { APP_TITLE, getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, Loader2, Phone, Trash2, Wrench } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function PhoneCleanup() {
  const [showResults, setShowResults] = useState(false);
  const [cleanupResults, setCleanupResults] = useState<any>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, name: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const cleanupMutation = trpc.cleanup.phoneNumbers.useMutation({
    onSuccess: (data) => {
      // Clear progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      
      setCleanupResults(data);
      setShowResults(true);
      setIsProcessing(false);
      setProgress({ current: 0, total: 0, name: '' });
      toast.success(`Cleanup complete! ${data.cleaned} phone numbers cleaned.`);
    },
    onError: (error) => {
      // Clear progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      
      setIsProcessing(false);
      setProgress({ current: 0, total: 0, name: '' });
      toast.error(`Cleanup failed: ${error.message}`);
    },
  });

  const runCleanup = (dryRun: boolean) => {
    setShowResults(false);
    setIsProcessing(true);
    
    // Clear any existing interval
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    
    // Simulate progress for better UX (actual processing happens on server)
    const estimatedTotal = 6000; // Approximate customer count
    const estimatedDuration = estimatedTotal * 0.05; // 50ms per record
    const updateInterval = 100; // Update every 100ms
    const steps = estimatedDuration / updateInterval;
    let currentStep = 0;
    
    progressIntervalRef.current = setInterval(() => {
      currentStep++;
      const progressPercent = Math.min((currentStep / steps) * 100, 95); // Cap at 95% until complete
      const currentRecord = Math.floor((progressPercent / 100) * estimatedTotal);
      setProgress({ 
        current: currentRecord, 
        total: estimatedTotal, 
        name: 'Processing...' 
      });
      
      // Don't clear the interval here - let onSuccess/onError handle it
    }, updateInterval);
    
    cleanupMutation.mutate({ dryRun });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{APP_TITLE}</h1>
              <p className="text-muted-foreground">Phone Number Data Cleanup</p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/">Home</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto py-8 space-y-6">
        {/* Info Card */}
        <Alert>
          <Phone className="h-4 w-4" />
          <AlertTitle>Phone Number Cleanup Tool</AlertTitle>
          <AlertDescription>
            This tool normalizes phone numbers to +44 format, extracts emails from phone fields, 
            and removes invalid entries. Run a dry run first to preview changes before applying them.
          </AlertDescription>
        </Alert>

        {/* Action Buttons */}
        <Card>
          <CardHeader>
            <CardTitle>Cleanup Actions</CardTitle>
            <CardDescription>
              Choose whether to preview changes (dry run) or apply them to the database
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Button
                onClick={() => runCleanup(true)}
                disabled={cleanupMutation.isPending}
                variant="outline"
                size="lg"
              >
                {cleanupMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Wrench className="w-4 h-4 mr-2" />
                )}
                Preview Changes (Dry Run)
              </Button>
              <Button
                onClick={() => runCleanup(false)}
                disabled={cleanupMutation.isPending}
                size="lg"
              >
                {cleanupMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                Apply Cleanup
              </Button>
            </div>
            
            {isProcessing && progress.total > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Processing customer records...
                  </span>
                  <span className="font-medium">
                    {progress.current} / {progress.total} ({Math.round((progress.current / progress.total) * 100)}%)
                  </span>
                </div>
                <Progress value={(progress.current / progress.total) * 100} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Estimated time remaining: {Math.max(0, Math.ceil((progress.total - progress.current) * 0.05 / 1000))}s
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {showResults && cleanupResults && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Customers</CardDescription>
                  <CardTitle className="text-3xl">{cleanupResults.total}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Cleaned</CardDescription>
                  <CardTitle className="text-3xl text-green-600">{cleanupResults.cleaned}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Emails Extracted</CardDescription>
                  <CardTitle className="text-3xl text-blue-600">{cleanupResults.emailsExtracted}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Invalid (Removed)</CardDescription>
                  <CardTitle className="text-3xl text-red-600">{cleanupResults.invalid}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Unchanged</CardDescription>
                  <CardTitle className="text-3xl text-gray-600">{cleanupResults.unchanged}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Details Table */}
            {cleanupResults.details && cleanupResults.details.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Changes Preview</CardTitle>
                  <CardDescription>
                    Showing {cleanupResults.details.length} changes
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border max-h-[600px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead>Original Phone</TableHead>
                          <TableHead>New Phone</TableHead>
                          <TableHead>Extracted Email</TableHead>
                          <TableHead>Issues</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cleanupResults.details.map((detail: any, index: number) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium">{detail.name}</TableCell>
                            <TableCell className="font-mono text-sm">{detail.originalPhone}</TableCell>
                            <TableCell className="font-mono text-sm">
                              {detail.newPhone ? (
                                <span className="text-green-600">{detail.newPhone}</span>
                              ) : (
                                <Badge variant="destructive" className="gap-1">
                                  <Trash2 className="w-3 h-3" />
                                  Removed
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {detail.extractedEmail ? (
                                <span className="text-blue-600">{detail.extractedEmail}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {detail.issues && detail.issues.length > 0 ? (
                                <div className="flex items-start gap-1">
                                  <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                                  <span className="text-xs text-orange-600">
                                    {detail.issues.join(", ")}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
