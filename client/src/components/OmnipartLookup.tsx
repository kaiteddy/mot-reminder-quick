import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, ShoppingCart, Wrench, Key, Lock, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export function OmnipartIntegration({ defaultVrm = "" }: { defaultVrm?: string }) {
  const [vrm, setVrm] = useState(defaultVrm);
  const [partQuery, setPartQuery] = useState("");
  
  const [sessionToken, setSessionToken] = useState(""); // Bearer token
  const [isConfiguring, setIsConfiguring] = useState(false);
  
  const [vehicle, setVehicle] = useState<any>(null);
  const [parts, setParts] = useState<any[]>([]);

  const vrmMutation = trpc.omnipart.lookupVrm.useMutation();
  const partsMutation = trpc.omnipart.getPartsInfo.useMutation();

  useEffect(() => {
    // Load saved token from localStorage if it exists or default to "auto" which triggers the database
    const savedToken = localStorage.getItem("omnipart_jwt_token");
    if (savedToken) {
      setSessionToken(savedToken);
    } else {
      setSessionToken("auto");
      setIsConfiguring(false); // don't force them open immediately, let "auto" try first
    }
  }, []);

  useEffect(() => {
    if (defaultVrm) setVrm(defaultVrm);
  }, [defaultVrm]);

  const commonCategories = [
    { label: "-- Select a Part --", value: "" },
    { label: "Engine Oil", value: "engine-oil" },
    { label: "Oil Filter", value: "oil-filter" },
    { label: "Air Filter", value: "air-filter" },
    { label: "Cabin / Pollen Filter", value: "cabin-filter" },
    { label: "Fuel Filter", value: "fuel-filter" },
    { label: "Spark Plugs", value: "spark-plugs" },
    { label: "Brake Pads", value: "brake-pads" },
    { label: "Brake Discs", value: "brake-discs" },
    { label: "Car Battery", value: "car-batteries" },
    { label: "Wiper Blades", value: "wiper-blades" },
    { label: "Timing Belt", value: "timing-belt-kit" },
    { label: "Water Pump", value: "water-pump" }
  ];

  const saveToken = () => {
    if (sessionToken === "auto" || sessionToken.trim() === "") {
        localStorage.removeItem("omnipart_jwt_token");
        setSessionToken("auto");
        toast.success("Switched to fully automated Harvester mode!");
        setIsConfiguring(false);
        return;
    }
    
    if (!sessionToken || sessionToken.length < 50) {
      toast.error("Please enter a valid JWT Bearer token or completely clear the box to use the Auto Harvester.");
      return;
    }
    localStorage.setItem("omnipart_jwt_token", sessionToken);
    toast.success("Omnipart Token saved successfully!");
    setIsConfiguring(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vrm) return;

    if (!sessionToken) {
      toast.error("Please configure your Omnipart Token first.");
      setIsConfiguring(true);
      return;
    }

    try {
      // Step 1: Lookup VRM
      toast.info(`Looking up vehicle ${vrm.toUpperCase()}...`);
      const vrmRes = await vrmMutation.mutateAsync({ 
        vrm: vrm.replace(/\s+/g, '').toUpperCase(), 
        token: sessionToken 
      });
      
      setVehicle(vrmRes);
      setParts([]);

      // Step 2: Lookup Parts if requested
      if (partQuery && vrmRes.vehicleId) {
        toast.info(`Finding ${partQuery} for ${vrmRes.make}...`);
        
        const slug = partQuery.toLowerCase().replace(/\s+/g, '-');
        
        const partsRes = await partsMutation.mutateAsync({
          vehicleId: vrmRes.vehicleId,
          vrm: vrm, // Provide VRM to help set the active session
          categorySlug: slug,
          token: sessionToken
        });

        if (partsRes.products && Array.isArray(partsRes.products) && partsRes.products.length > 0) {
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
      
      const msg = err.message || "Failed to communicate with Euro Car Parts";
      
      if (msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("token")) {
        // Automatically purge broken local tokens
        localStorage.removeItem("omnipart_jwt_token");
        setSessionToken("auto");
        
        toast.error(`Omnipart Error: ${msg}. Your saved token was invalid/expired and has been wiped. Trying to fall back to the Auto Harvester...`);
        setIsConfiguring(true);
      } else {
        toast.error(msg);
      }
    }
  };

  const isWorking = vrmMutation.isPending || partsMutation.isPending;

  return (
    <div className="space-y-6">
      <Card className="border-blue-200">
        <CardHeader className="bg-blue-50/50 pb-4 border-b border-blue-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-blue-900 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-blue-600" />
              Omnipart Trade Portal Integration
            </CardTitle>
            <CardDescription className="text-blue-700/80 mt-1">
              Fetch live trade prices and stock from Euro Car Parts.
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsConfiguring(!isConfiguring)}
            className="gap-2 shrink-0 bg-white"
          >
            <Lock className="w-4 h-4" />
            {isConfiguring ? "Close Config" : "Update Token"}
          </Button>
        </CardHeader>
        <CardContent className="pt-6">
          
          {isConfiguring && (
            <div className="mb-8 p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
                  <Key className="w-5 h-5 text-amber-500" />
                  Omnipart Connection Required
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed mb-4">
                  Euro Car Parts bot protection blocks automated logins. To connect your live prices, you must copy your active session token directly from the Omnipart website. Your token is saved securely in your browser.
                </p>
                
                <div className="bg-slate-900 text-slate-300 p-4 rounded-lg font-mono text-xs space-y-2 mb-4">
                  <p className="text-white font-bold flex items-center gap-2 mb-2"><TerminalSquare className="w-4 h-4 text-emerald-400" /> How to get your Token:</p>
                  <p>1. Open <a href="https://omnipart.eurocarparts.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">omnipart.eurocarparts.com</a> and log in normally.</p>
                  <p>2. Right-click anywhere and click <b>Inspect</b>.</p>
                  <p>3. Click the <b>Network</b> tab (you may need to click &gt;&gt; to find it).</p>
                  <p>4. Type a number plate into their search and click Get Parts.</p>
                  <p>5. In the Network tab, look for a request named <b>vrm</b>, click it, and look at the <b>Headers</b> section.</p>
                  <p>6. Scroll down to <b>Request Headers</b> and look for <b>Authorization: Bearer eyJhbG...</b></p>
                  <p>7. Copy the enormously long string of text starting with <b>eyJ...</b> (Do not copy the word "Bearer ").</p>
                  <p className="mt-2 text-emerald-400 font-bold">Paste that token into the box below!</p>
                </div>

                <div className="bg-blue-900/10 border border-blue-900/20 text-blue-900 p-4 rounded-lg text-sm space-y-2 mb-4">
                    <p className="font-bold flex items-center gap-2">💡 Pro Tip: Automate This!</p>
                    <p>You can completely eliminate this manual copy-pasting step by installing the <b>Autodata Session Harvester</b> Chrome Extension. It runs silently in the background and instantly sends your login token to the application anytime you use Euro Car Parts.</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Input 
                  type="text"
                  autoComplete="off"
                  spellCheck="false"
                  data-1p-ignore="true" 
                  data-lpignore="true"
                  value={sessionToken === "auto" ? "" : sessionToken} 
                  onChange={(e) => setSessionToken(e.target.value.trim() === "" ? "auto" : e.target.value)}
                  placeholder={sessionToken === "auto" ? "Using Autodata Harvester automatically..." : "Paste your eyJ... token here"}
                  className="font-mono text-xs"
                />
                <Button onClick={saveToken} className="bg-slate-800 hover:bg-slate-900 text-white shrink-0">
                  Save Setup
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1">
              <Input 
                placeholder="Registration (e.g. RE16 RWP)" 
                value={vrm} onChange={e => setVrm(e.target.value)} 
                className="font-mono text-lg uppercase bg-white border-slate-300"
                maxLength={8}
                disabled={isWorking}
              />
            </div>
            <div className="flex-1">
              <select
                value={partQuery} 
                onChange={e => setPartQuery(e.target.value)} 
                disabled={isWorking}
                className="w-full h-10 px-3 py-2 bg-white border border-slate-300 rounded-md text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {commonCategories.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={isWorking || !vrm} className="bg-blue-600 hover:bg-blue-700 text-white">
              {isWorking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Lookup Vehicle & Parts
            </Button>
          </form>

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
                  <Card key={i} className="overflow-hidden bg-white">
                    <div className="p-4 flex flex-col h-full">
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
