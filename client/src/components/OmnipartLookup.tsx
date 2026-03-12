import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, ShoppingCart, AlertCircle, Wrench, Key } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useGoogleReCaptcha, GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

// Provide your actual Euro Car Parts Recaptcha V3 Site Key here
// Usually starts with '6L'
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_OMNIPART_RECAPTCHA_KEY || "";

function OmnipartSearch() {
  const { executeRecaptcha } = useGoogleReCaptcha();
  const [vrm, setVrm] = useState("");
  const [partQuery, setPartQuery] = useState("");
  
  const [authStatus, setAuthStatus] = useState<"idle" | "authenticating" | "success" | "error">("idle");
  const [sessionToken, setSessionToken] = useState(""); // Bearer token
  
  const [vehicle, setVehicle] = useState<any>(null);
  const [parts, setParts] = useState<any[]>([]);

  const loginMutation = trpc.omnipart.loginOmnipart.useMutation();
  const vrmMutation = trpc.omnipart.lookupVrm.useMutation();
  const partsMutation = trpc.omnipart.getPartsInfo.useMutation();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vrm) return;

    if (!executeRecaptcha) {
      toast.error("ReCaptcha is not ready yet");
      return;
    }

    try {
      let tokenToUse = sessionToken;
      
      // Step 1: Authenticate if we don't have a session
      if (!sessionToken) {
        setAuthStatus("authenticating");
        toast.info("Generating secure ReCaptcha token...");
        const recaptchaToken = await executeRecaptcha("login");
        
        if (!recaptchaToken) throw new Error("Failed to generate ReCaptcha token");
        
        toast.info("Logging into Epic/Omnipart securely...");
        const loginRes = await loginMutation.mutateAsync({ recaptchaToken });
        tokenToUse = loginRes.token;
        setSessionToken(loginRes.token);
        setAuthStatus("success");
      }

      // Step 2: Lookup VRM
      toast.info(`Looking up vehicle ${vrm.toUpperCase()}...`);
      const vrmRes = await vrmMutation.mutateAsync({ 
        vrm: vrm.replace(/\s+/g, '').toUpperCase(), 
        token: tokenToUse 
      });
      
      setVehicle(vrmRes);
      setParts([]);

      // Step 3: Lookup Parts if requested
      if (partQuery && vrmRes.vehicleId) {
        toast.info(`Finding ${partQuery} for ${vrmRes.make}...`);
        
        // Let's assume partQuery could be mapped to a category slug, or we just pass it as category slug for now
        // In reality, Omnipart maps categories via slugs like "brake-pads"
        const slug = partQuery.toLowerCase().replace(/\s+/g, '-');
        
        const partsRes = await partsMutation.mutateAsync({
          vehicleId: vrmRes.vehicleId,
          categorySlug: slug,
          token: tokenToUse
        });

        if (partsRes.products && Array.isArray(partsRes.products)) {
          setParts(partsRes.products);
          toast.success(`Found ${partsRes.products.length} parts!`);
        } else {
          toast.error("No parts found for this category.");
        }
      } else {
        toast.success(`Vehicle identified: ${vrmRes.make} ${vrmRes.model}`);
      }

    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to communicate with Euro Car Parts");
      setAuthStatus("error");
    }
  };

  const isWorking = loginMutation.isPending || vrmMutation.isPending || partsMutation.isPending;

  return (
    <div className="space-y-6">
      <Card className="border-blue-200">
        <CardHeader className="bg-blue-50/50 pb-4 border-b border-blue-100">
          <CardTitle className="text-blue-900 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            Omnipart Trade Portal Integration
          </CardTitle>
          <CardDescription className="text-blue-700/80">
            Automatically log in and fetch live trade prices and stock from Euro Car Parts.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input 
                placeholder="Registration (e.g. RE16 RWP)" 
                value={vrm} onChange={e => setVrm(e.target.value)} 
                className="font-mono text-lg uppercase"
                maxLength={8}
                disabled={isWorking}
              />
            </div>
            <div className="flex-1">
              <Input 
                placeholder="Part Category (e.g. brake-pads)" 
                value={partQuery} onChange={e => setPartQuery(e.target.value)} 
                disabled={isWorking}
              />
            </div>
            <Button type="submit" disabled={isWorking || !vrm} className="bg-blue-600 hover:bg-blue-700">
              {isWorking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              {authStatus === 'authenticating' ? 'Authenticating...' : 'Lookup Vehicle & Parts'}
            </Button>
          </form>

          {authStatus === "success" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-green-600 font-medium bg-green-50 p-3 rounded-lg border border-green-200">
              <Key className="w-4 h-4" />
              Secure session established with Omnipart
            </div>
          )}

          {vehicle && (
            <div className="mt-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2 mb-4">
                <Wrench className="w-5 h-5 text-slate-500" />
                {vehicle.make} {vehicle.model}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-slate-500">Engine Code</div>
                  <div className="font-medium">{vehicle.engineCode || "Unknown"}</div>
                </div>
                <div>
                  <div className="text-slate-500">BHP</div>
                  <div className="font-medium">{vehicle.bhp || "Unknown"}</div>
                </div>
                <div>
                  <div className="text-slate-500">Fuel</div>
                  <div className="font-medium">{vehicle.fuel || "Unknown"}</div>
                </div>
                <div>
                  <div className="text-slate-500">Year</div>
                  <div className="font-medium">{vehicle.year || "Unknown"}</div>
                </div>
              </div>
            </div>
          )}

          {parts.length > 0 && (
            <div className="mt-6 space-y-4">
              <h3 className="font-semibold text-slate-800">Trade Pricing Results:</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {parts.map((p: any, i) => (
                  <Card key={i} className="overflow-hidden">
                    <div className="p-4 flex flex-col h-full bg-white">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-bold text-sm text-slate-700">{p.brandName || "Part"}</span>
                        <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">
                          {p.branchStock || 0} In Local Store
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mb-4">{p.sku || "Unknown SKU"}</p>
                      
                      <div className="mt-auto pt-4 border-t border-slate-100 flex justify-between items-end">
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Retail Price</p>
                          <p className="text-slate-500 line-through text-sm">£{(p.rrp || 0).toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-green-600 uppercase font-bold tracking-wider">Your Trade Price</p>
                          <p className="text-xl font-bold text-green-700">£{(p.netPrice || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Wrapper component to provide Recaptcha context
export function OmnipartIntegration() {
  if (!RECAPTCHA_SITE_KEY) {
    return (
      <Alert variant="destructive" className="border-red-300 bg-red-50 text-red-900 shadow-sm">
        <AlertCircle className="w-5 h-5 text-red-600" />
        <AlertTitle className="text-red-800 font-bold mb-1">Omnipart Configuration Required</AlertTitle>
        <AlertDescription className="text-sm">
          To use the live Euro Car Parts integration, you must provide your Recaptcha Site Key.<br/><br/>
          <b>Action Required:</b> Set the <code>VITE_OMNIPART_RECAPTCHA_KEY</code> environment variable in Vercel to activate this module.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <GoogleReCaptchaProvider reCaptchaKey={RECAPTCHA_SITE_KEY}>
      <OmnipartSearch />
    </GoogleReCaptchaProvider>
  );
}
