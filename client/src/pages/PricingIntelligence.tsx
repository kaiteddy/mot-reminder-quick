import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Brain, Save, Loader2, Search, Settings2, FileSpreadsheet } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PricingIntelligence() {
  const [searchQuery, setSearchQuery] = useState("");
  
  const [labourRate, setLabourRate] = useState("70");
  const [motCost, setMotCost] = useState("45");
  const [serviceSmall, setServiceSmall] = useState("124");
  const [serviceMedium, setServiceMedium] = useState("124");
  const [serviceLarge, setServiceLarge] = useState("154");
  const [customKnowledge, setCustomKnowledge] = useState("");

  const { data: pricingData, isLoading: isLoadingSettings } = trpc.ai.getPricingKnowledge.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (pricingData && typeof pricingData === 'object') {
      const p = pricingData as any;
      if (p.labourRate) setLabourRate(p.labourRate.toString());
      if (p.motCost) setMotCost(p.motCost.toString());
      if (p.serviceSmall) setServiceSmall(p.serviceSmall.toString());
      if (p.serviceMedium) setServiceMedium(p.serviceMedium.toString());
      if (p.serviceLarge) setServiceLarge(p.serviceLarge.toString());
      if (p.customKnowledge) setCustomKnowledge(p.customKnowledge);
    }
  }, [pricingData]);

  const { data: historicalData, isLoading: isLoadingMetrics } = trpc.ai.getHistoricalPricingMetrics.useQuery();

  const saveMutation = trpc.ai.savePricingKnowledge.useMutation({
    onSuccess: () => {
      toast.success("Settings saved successfully!");
    },
    onError: (err) => {
      toast.error("Failed to save: " + err.message);
    }
  });

  const handleSave = () => {
    saveMutation.mutate({
      labourRate: parseFloat(labourRate) || 70,
      motCost: parseFloat(motCost) || 45,
      serviceSmall: parseFloat(serviceSmall) || 124,
      serviceMedium: parseFloat(serviceMedium) || 124,
      serviceLarge: parseFloat(serviceLarge) || 154,
      customKnowledge,
    });
  };

  const filteredMetrics = useMemo(() => {
    if (!historicalData) return [];
    if (!searchQuery) return historicalData.filter(d => d.frequency > 1);
    
    const query = searchQuery.toLowerCase();
    return historicalData.filter(d => 
        (d.partName || '').toLowerCase().includes(query)
    );
  }, [historicalData, searchQuery]);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Brain className="w-8 h-8 text-indigo-600" />
            Pricing Intelligence
          </h1>
          <p className="text-muted-foreground mt-2">
            The system automatically scans your invoice history. No manual entry required—every past job trains the AI so regressions and overcharging automatically drop off. View your natural shop averages below.
          </p>
        </div>

        <Tabs defaultValue="extracted" className="space-y-4">
            <TabsList>
                <TabsTrigger value="extracted" className="font-semibold text-indigo-700 data-[state=active]:bg-indigo-50">
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Automatically Learned Pricing
                </TabsTrigger>
                <TabsTrigger value="settings" className="font-semibold text-slate-700">
                    <Settings2 className="w-4 h-4 mr-2" />
                    Base Rates & Manual Overrides
                </TabsTrigger>
            </TabsList>

            <TabsContent value="extracted">
                <Card className="border-indigo-100 shadow-sm">
                    <CardHeader className="bg-indigo-50/50 pb-4 border-b">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-indigo-900">Extracted Invoice Intelligence</CardTitle>
                                <CardDescription className="text-indigo-700/70">
                                    Averages are automatically calculated from parts and labour lines across all your historical invoices.
                                </CardDescription>
                            </div>
                            <div className="relative w-64">
                                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                                <Input 
                                    placeholder="Search extracted parts..." 
                                    className="pl-9 bg-white border-indigo-200"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {isLoadingMetrics ? (
                            <div className="flex justify-center items-center py-24 text-indigo-600">
                                <Loader2 className="w-8 h-8 animate-spin" />
                            </div>
                        ) : (
                            <ScrollArea className="h-[600px] w-full rounded-b-lg border-b">
                                <Table>
                                    <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                        <TableRow>
                                            <TableHead className="font-bold text-slate-700">Item Description</TableHead>
                                            <TableHead className="text-right font-bold text-slate-700">Frequency</TableHead>
                                            <TableHead className="text-right font-bold text-slate-700">Min Price</TableHead>
                                            <TableHead className="text-right font-bold text-slate-700">Max Price</TableHead>
                                            <TableHead className="text-right font-bold text-indigo-700 text-lg">Avg Price</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredMetrics.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-12 text-slate-500">
                                                    No historically learned items found for this query.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            filteredMetrics.map((item, i) => (
                                                <TableRow key={i} className="hover:bg-slate-50/50">
                                                    <TableCell className="font-semibold text-slate-700 max-w-sm truncate" title={item.partName || ''}>
                                                        {item.partName || 'UNKNOWN'}
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium text-slate-600">
                                                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs border border-slate-200">
                                                            x{item.frequency}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right text-slate-500">£{Number(item.minPrice).toFixed(2)}</TableCell>
                                                    <TableCell className="text-right text-slate-500">£{Number(item.maxPrice).toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-bold text-indigo-600 text-base">£{Number(item.avgPrice).toFixed(2)}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="settings">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-slate-500" />
                        Base Rates
                    </CardTitle>
                    <CardDescription>
                        These fixed rates form the foundation of all AI estimates.
                    </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-2">
                        <Label>Standard Labour Rate (£ / hour)</Label>
                        <Input 
                            type="number" 
                            value={labourRate} 
                            onChange={(e) => setLabourRate(e.target.value)} 
                            className="font-semibold text-lg"
                        />
                        </div>
                        <div className="space-y-2">
                        <Label>Fixed MOT Cost (£)</Label>
                        <Input 
                            type="number" 
                            value={motCost} 
                            onChange={(e) => setMotCost(e.target.value)} 
                            className="font-semibold text-lg"
                        />
                        </div>
                    </div>

                    <div className="pt-4 border-t">
                        <h3 className="font-semibold mb-4 text-slate-700">Standard Service Labour Fees</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Small Service (£)</Label>
                            <Input 
                            type="number" 
                            value={serviceSmall} 
                            onChange={(e) => setServiceSmall(e.target.value)} 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Medium Service (£)</Label>
                            <Input 
                            type="number" 
                            value={serviceMedium} 
                            onChange={(e) => setServiceMedium(e.target.value)} 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Large Service (£)</Label>
                            <Input 
                            type="number" 
                            value={serviceLarge} 
                            onChange={(e) => setServiceLarge(e.target.value)} 
                            />
                        </div>
                        </div>
                    </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Brain className="w-5 h-5 text-purple-500" />
                        Custom Overrides
                    </CardTitle>
                    <CardDescription>
                        Use this space ONLY if you want to explicitly overwrite an automatically learned price. (e.g. "We ALWAYS charge £60 for a Diagnostic check")
                    </CardDescription>
                    </CardHeader>
                    <CardContent>
                    <div className="space-y-2">
                        <Textarea 
                        value={customKnowledge}
                        onChange={(e) => setCustomKnowledge(e.target.value)}
                        placeholder="e.g. Diagnostics are always £60. \nWe charge 1.5 hours strictly for brake pads & discs."
                        className="min-h-[160px] font-mono text-sm leading-relaxed whitespace-pre-wrap"
                        />
                    </div>
                    </CardContent>
                    <CardFooter className="bg-slate-50 border-t py-4">
                    <Button 
                        onClick={handleSave} 
                        disabled={saveMutation.isPending}
                        className="w-full"
                    >
                        {saveMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                        ) : (
                        <><Save className="w-4 h-4 mr-2" /> Save Overrides</>
                        )}
                    </Button>
                    </CardFooter>
                </Card>
                </div>
            </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
