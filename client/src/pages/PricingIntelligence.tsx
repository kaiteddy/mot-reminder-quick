import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Brain, Save, Loader2, Info, TrendingUp, Settings2 } from "lucide-react";

export default function PricingIntelligence() {
  const [labourRate, setLabourRate] = useState("70");
  const [motCost, setMotCost] = useState("45");
  const [serviceSmall, setServiceSmall] = useState("124");
  const [serviceMedium, setServiceMedium] = useState("124");
  const [serviceLarge, setServiceLarge] = useState("154");
  const [customKnowledge, setCustomKnowledge] = useState("");

  const { data: pricingData, isLoading } = trpc.ai.getPricingKnowledge.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const saveMutation = trpc.ai.savePricingKnowledge.useMutation({
    onSuccess: () => {
      toast.success("Pricing knowledge updated! The AI will now use these rates.");
    },
    onError: (err) => {
      toast.error("Failed to save pricing: " + err.message);
    }
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

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Brain className="w-8 h-8 text-primary" />
            Pricing Intelligence
          </h1>
          <p className="text-muted-foreground mt-2">
            Configure the baseline pricing that the AI uses to generate accurate MOT & Repair estimates based on your exact garage prices.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            <div className="lg:col-span-2 space-y-6">
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
                    AI Core Pricing Knowledge
                  </CardTitle>
                  <CardDescription>
                    Teach the AI about your specific parts pricing, oil grades, and standard repair times.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label>Custom Intelligence Instructions</Label>
                    <Textarea 
                      value={customKnowledge}
                      onChange={(e) => setCustomKnowledge(e.target.value)}
                      placeholder="e.g. Standard 5w/30 oil is usually £45, 0w/30 is £55. Premium wiper blades are £24. We charge 1.5 hours for brake pads & discs."
                      className="min-h-[200px] font-mono text-sm leading-relaxed whitespace-pre-wrap"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      The AI reads this text literally before every estimate. Be as specific as possible with your pricing rules!
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="bg-slate-50 border-t py-4">
                  <Button 
                    onClick={handleSave} 
                    disabled={saveMutation.isPending}
                    className="w-full sm:w-auto ml-auto"
                  >
                    {saveMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving Intelligence...</>
                    ) : (
                      <><Save className="w-4 h-4 mr-2" /> Save Knowledge</>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader>
                  <CardTitle className="text-blue-900 flex items-center gap-2">
                    <Info className="w-5 h-5" />
                    How this works
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-blue-800 space-y-4">
                  <p>
                    Every time you click "Generate Repair Estimate" on the MOT Check page, the AI reads these settings to build an accurate quote.
                  </p>
                  <p>
                    <strong>Labour Rules:</strong> It will look at the defect and calculate time required × your Hourly Rate (£{labourRate}).
                  </p>
                  <p>
                    <strong>Custom Rules:</strong> If you write "Brake fluid change is always £40" in the text box, the AI will hardcode £40 into the estimate whenever it sees brake fluid issues!
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-700">
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                    Suggested Rules
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-4 text-slate-600">
                  <div>
                    <strong>Common Oils:</strong>
                    <p className="text-xs mt-1">"5/30 oil is £45, 0w/30 is £55, 0w/20 is £60"</p>
                  </div>
                  <div>
                    <strong>Standard Labour Times:</strong>
                    <p className="text-xs mt-1">"Changing a coil spring takes 1.5 hours. Track rod ends take 1 hour per side."</p>
                  </div>
                  <div>
                    <strong>Diagnostic Fees:</strong>
                    <p className="text-xs mt-1">"Always add a £60 diagnostic fee for engine light issues."</p>
                  </div>
                </CardContent>
              </Card>
            </div>

          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
