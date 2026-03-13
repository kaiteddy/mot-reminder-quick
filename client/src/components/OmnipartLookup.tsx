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

  const [estimateItems, setEstimateItems] = useState<any[]>([]);
  const [customQuery, setCustomQuery] = useState("");
  const [labourRate, setLabourRate] = useState<number | string>("");

  const addToEstimate = (part: any) => {
    // Default retail to RRP, or if RRP is missing/zero, provide a 40% margin on netPrice.
    // Then safely add 20% VAT on top for the final inc-VAT retail recommendation.
    const baseRetail = (part.rrp && part.rrp > part.netPrice) ? part.rrp : (part.netPrice || 0) * 1.4;
    const retailIncVat = baseRetail * 1.2;
    
    setEstimateItems(prev => [...prev, { ...part, customRetail: retailIncVat }]);
    toast.success(`Added ${part.name} to estimate`);
  };

  const removeFromEstimate = (index: number) => {
    setEstimateItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateEstimateRetail = (index: number, newRetail: string | number) => {
    setEstimateItems(prev => prev.map((item, i) => i === index ? { ...item, customRetail: newRetail } : item));
  };
  
  const estimateTotal = estimateItems.reduce((sum, item) => sum + (item.netPrice || 0), 0);
  const estimateRetailTotal = estimateItems.reduce((sum, item) => sum + (parseFloat(item.customRetail as string) || 0), 0);
  const totalCustomerQuote = estimateRetailTotal + (parseFloat(labourRate as string) || 0);

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
    { label: "Brake Discs", value: "brake-disc" },
    { label: "Brake Pads", value: "brake-pad" },
    { label: "Clutch Kits", value: "clutch-kit" },
    { label: "Wheel Bearings & Hubs", value: "wheel-bearing-and-wheel-hub" },
    { label: "Water Pumps & Gaskets", value: "water-pump-gasket" },
    { label: "Alternators", value: "alternator" },
    { label: "Car Battery", value: "car-battery" },
    { label: "Starter Motors", value: "starter-motor" },
    { label: "Spark Plugs", value: "spark-plug" },
    { label: "Engine Oil", value: "engine-oils" },
    { label: "Exhaust Systems", value: "exhaust-system" },
    { label: "Turbo Chargers", value: "turbocharger" },
    { label: "Fuel Pumps & Sender", value: "fuel-pump-sending-unit" },
    { label: "Air Filters", value: "air-filter" },
    { label: "Fuel Filters", value: "fuel-filter" },
    { label: "Oil Filters", value: "oil-filter" },
    { label: "Shock Absorbers", value: "shock-absorber" },
    { label: "Springs", value: "coil-spring" },
    { label: "EGR Valves", value: "egr-valves" },
    { label: "Timing Belt Kit", value: "timing-belt-kit" },
    { label: "Wiper Blades", value: "wiper-blades" },
    { label: "Other (Type manually)", value: "custom" }
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
      if ((partQuery || (partQuery === "custom" && customQuery)) && vrmRes.vehicleId) {
        const queryLabel = partQuery === "custom" ? customQuery : partQuery;
        toast.info(`Finding ${queryLabel} for ${vrmRes.make}...`);
        
        // Remove unsafe characters for SEO slug matching
        const slug = partQuery === "custom" 
           ? encodeURIComponent(customQuery.toLowerCase().replace(/[^a-z0-9]+/g, '-')) 
           : partQuery.toLowerCase().replace(/\s+/g, '-');
        
        const partsRes = await partsMutation.mutateAsync({
          vehicleId: vrmRes.vehicleId.toString(),
          vrm: vrm, // Provide VRM to help set the active session
          categorySlug: partQuery === "custom" ? customQuery : slug,
          isCustomSearch: partQuery === "custom",
          token: sessionToken
        });

        if (partsRes.products && Array.isArray(partsRes.products) && partsRes.products.length > 0) {
          // Sort lowest to highest price
          const sorted = [...partsRes.products].sort((a, b) => (a.netPrice || 0) - (b.netPrice || 0));
          setParts(sorted);
          toast.success(`Found ${sorted.length} parts!`);
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
            <div className={`flex-1 flex flex-col sm:flex-row gap-2 ${partQuery === "custom" ? "sm:col-span-2" : ""}`}>
              <select
                value={partQuery} 
                onChange={e => {
                  setPartQuery(e.target.value);
                  if (e.target.value !== "custom") setCustomQuery("");
                }} 
                disabled={isWorking}
                className="w-full h-10 px-3 py-2 bg-white border border-slate-300 rounded-md text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {commonCategories.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
              {partQuery === "custom" && (
                <Input 
                  placeholder="E.g. spark plug, alternators..."
                  value={customQuery}
                  onChange={e => setCustomQuery(e.target.value)}
                  className="w-full sm:w-1/2 h-10 bg-white border-slate-300"
                  disabled={isWorking}
                  autoFocus
                />
              )}
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

          {estimateItems.length > 0 && (
            <div className="mt-6 bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-xl print:bg-white print:border-gray-200 print:shadow-none text-white print:text-black">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5" />
                  Live Parts Estimate
                </h3>
                <Badge variant="outline" className="text-blue-300 border-blue-400 print:text-black print:border-black">
                  {estimateItems.length} {estimateItems.length === 1 ? 'Item' : 'Items'}
                </Badge>
              </div>
              <div className="space-y-2 mb-4">
                {estimateItems.map((item, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row justify-between sm:items-center bg-slate-700 print:bg-gray-50 p-2 sm:p-3 rounded-md gap-4">
                    <div className="flex-1">
                      <div className="font-semibold text-sm">{item.name}</div>
                      <div className="text-xs text-slate-300 print:text-gray-500">{item.brandName} • {item.sku}</div>
                    </div>
                    <div className="flex items-center gap-4 self-end sm:self-auto">
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Trade (Ex VAT)</div>
                        <div className="font-medium text-slate-200 print:text-slate-700">£{(item.netPrice || 0).toFixed(2)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5" title="Includes 20% VAT">Retail (Inc VAT)</div>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-300 print:text-slate-600">£</span>
                          <Input 
                            type="number" 
                            step="0.01"
                            value={item.customRetail !== undefined ? item.customRetail : ""} 
                            onChange={(e) => updateEstimateRetail(idx, e.target.value)}
                            className="w-24 h-8 px-1.5 text-right font-medium text-green-400 bg-slate-800 border-slate-600 print:bg-white print:text-green-700 print:border-slate-300 focus-visible:ring-1 focus-visible:ring-blue-500"
                          />
                        </div>
                      </div>
                      <button onClick={() => removeFromEstimate(idx)} className="text-slate-400 hover:text-red-400 print:hidden text-lg p-1" title="Remove part">&times;</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center border-t border-slate-600 print:border-gray-300 pt-4 mt-4 gap-4">
                <div className="flex items-center gap-3 bg-slate-700/50 print:bg-transparent p-2 sm:p-0 rounded-md w-full sm:w-auto">
                  <div className="text-sm text-slate-300 print:text-gray-600 whitespace-nowrap">
                    Labour Rate: <span className="text-[10px] uppercase text-slate-400">(Inc VAT)</span>
                  </div>
                  <div className="flex items-center gap-1">
                     <span className="text-slate-300 text-sm print:text-slate-600">£</span>
                     <Input 
                        type="number" 
                        step="0.01" 
                        value={labourRate} 
                        onChange={(e) => setLabourRate(e.target.value)} 
                        placeholder="0.00"
                        className="w-24 h-9 px-2 text-right bg-slate-700 border-slate-600 print:bg-gray-50 focus-visible:ring-blue-500 text-white print:text-black font-medium"
                     />
                  </div>
                </div>
                <div className="flex items-end gap-6 text-right">
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Total Trade Cost</div>
                    <div className="text-lg font-semibold text-slate-300 print:text-slate-600">£{estimateTotal.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-blue-300 uppercase tracking-widest mb-1">Customer Quote <span className="lowercase text-[10px] opacity-80">(Inc VAT & Labour)</span></div>
                    <div className="text-3xl font-bold text-green-400 print:text-green-700">£{totalCustomerQuote.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {parts.length > 0 && (
            <div className="mt-6 space-y-4">
              <h3 className="font-semibold text-slate-800">Trade Pricing Results:</h3>
              <div className="rounded-lg border border-slate-200 shadow-sm relative z-0">
                <table className="w-full text-sm text-left text-slate-600 relative">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th scope="col" className="px-4 py-3 w-32">Brand</th>
                      <th scope="col" className="px-4 py-3 w-24">Image</th>
                      <th scope="col" className="px-4 py-3 min-w-[200px]">SKU & Details</th>
                      <th scope="col" className="px-4 py-3 text-center whitespace-nowrap">Local Stock</th>
                      <th scope="col" className="px-4 py-3 text-right">Retail</th>
                      <th scope="col" className="px-4 py-3 text-right">Trade Price</th>
                      <th scope="col" className="px-4 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((p: any, i) => (
                      <tr key={i} className="bg-white border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 align-middle">
                          {p.brandImageUrl ? (
                            <div className="h-8 flex items-center justify-start">
                              <img src={p.brandImageUrl} alt={p.brandName || "Brand"} className="max-h-full max-w-[80px] object-contain mix-blend-multiply" />
                            </div>
                          ) : (
                            <span className="font-bold text-slate-700">{p.brandName || "Part"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle relative">
                          {p.imageUrl ? (
                            <div className="group flex items-center h-12 w-16">
                              <img 
                                src={p.imageUrl} 
                                alt={p.name} 
                                className="h-full w-full object-contain mix-blend-multiply cursor-zoom-in group-hover:absolute transition-transform duration-200 ease-out sm:group-hover:scale-[3.5] group-hover:scale-[2.0] group-hover:z-[99999] group-hover:-translate-y-4 group-hover:translate-x-4 bg-white rounded-md shadow-sm group-hover:shadow-2xl group-hover:border group-hover:border-slate-300 p-1" 
                              />
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[10px]">No image</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="font-medium text-slate-800">{p.name || "Unknown Part"}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{p.sku || "Unknown SKU"}</div>
                        </td>
                        <td className="px-4 py-3 align-middle text-center">
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200 whitespace-nowrap">
                            {p.branchStock || 0}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 align-middle text-right">
                          <span className="text-slate-400 line-through text-xs">£{(p.rrp || 0).toFixed(2)}</span>
                        </td>
                        <td className="px-4 py-3 align-middle text-right">
                          <span className="text-lg font-bold text-green-700">£{(p.netPrice || 0).toFixed(2)}</span>
                        </td>
                        <td className="px-4 py-3 align-middle text-right">
                          <Button 
                            variant="default" 
                            size="sm" 
                            className="bg-slate-800 hover:bg-slate-900 text-white rounded px-3 transition-colors shadow-sm"
                            onClick={() => addToEstimate(p)}
                            title="Add to Live Estimate Cart"
                          >
                            + Add
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
