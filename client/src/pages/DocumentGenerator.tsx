import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
    Plus,
    Trash2,
    Printer,
    Download,
    Save,
    ChevronLeft,
    Car,
    User,
    FileText,
    Settings,
    Loader2,
    Zap,
    Droplet,
    Thermometer,
    Fuel,
    History,
    Calendar,
    Clock
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useReactToPrint } from "react-to-print";
import { format } from "date-fns";
import { useLocation, useParams } from "wouter";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ServiceHistory } from "@/components/ServiceHistory";

interface LineItem {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    subNet: number;
    itemType: "Labour" | "Part";
}

export default function DocumentGenerator() {
    const params = useParams();
    const [, setLocation] = useLocation();
    const utils = trpc.useUtils();
    const fetchTechData = trpc.vehicles.fetchTechnicalData.useMutation({
        onSuccess: () => {
            toast.success("Rich technical data updated!");
            utils.vehicles.getByRegistration.invalidate();
        },
        onError: (err) => {
            toast.error("Failed to fetch tech specs: " + err.message);
        }
    });

    const [docType, setDocType] = useState<"SI" | "ES">("SI");
    const [docNo, setDocNo] = useState("");
    const [dateCreated, setDateCreated] = useState(format(new Date(), "yyyy-MM-dd"));
    const [orderRef, setOrderRef] = useState("-");
    const [paymentMethod, setPaymentMethod] = useState("-");
    const [accountNo, setAccountNo] = useState("");
    const [customerId, setCustomerId] = useState<number | null>(null);
    const [vehicleId, setVehicleId] = useState<number | null>(null);
    const [registration, setRegistration] = useState("");
    const [debouncedReg, setDebouncedReg] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [mileage, setMileage] = useState("");
    const [workDone, setWorkDone] = useState("");
    const [paintMaterials, setPaintMaterials] = useState(0);
    const [excess, setExcess] = useState(0);
    const [labourItems, setLabourItems] = useState<LineItem[]>([
        { id: Math.random().toString(), description: "", quantity: 1, unitPrice: 0, subNet: 0, itemType: "Labour" }
    ]);
    const [partsItems, setPartsItems] = useState<LineItem[]>([
        { id: Math.random().toString(), description: "", quantity: 1, unitPrice: 0, subNet: 0, itemType: "Part" }
    ]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedReg(registration);
        }, 300);
        return () => clearTimeout(timer);
    }, [registration]);

    const { data: customers } = trpc.customers.list.useQuery();

    // 1. If we have a registration typed in, use that lookup (fast, single record)
    const { data: lookupData, isLoading: isLookingUp } = trpc.vehicles.getByRegistration.useQuery(
        { registration: debouncedReg.replace(/\s/g, "").toUpperCase() },
        { enabled: debouncedReg.length >= 5 }
    );

    // 0. Search for suggestions as the user types
    const { data: suggestions } = trpc.vehicles.search.useQuery(
        { query: registration },
        { enabled: registration.length >= 2 && !isLookingUp }
    );

    // 2. If we have a vehicleId (from a link), use that lookup
    const { data: vehicleByIdData } = trpc.vehicles.getById.useQuery(
        { id: vehicleId! },
        { enabled: !!vehicleId && registration.length < 5 }
    );

    // 3. If a customer is selected, get their specific vehicles only
    const { data: customerVehicles } = trpc.vehicles.listByCustomer.useQuery(
        { customerId: customerId! },
        { enabled: !!customerId }
    );

    // Synthesize the active vehicle data from whichever query is fresher/present
    const activeVehicleData = lookupData || vehicleByIdData;
    const selectedVehicle = activeVehicleData?.vehicle;
    const selectedCustomer = activeVehicleData?.customer || customers?.find(c => c.id === customerId);
    const vehicleStats = activeVehicleData?.stats;
    const vehicleHistory = activeVehicleData?.history || [];

    // External lookup fallback (DVLA)
    const motLookup = trpc.reminders.lookupMOT.useMutation({
        onSuccess: (data: any) => {
            if (data && !vehicleId) {
                toast.info("Pulled latest specs from DVLA");
            }
        }
    });

    useEffect(() => {
        const queryParams = new URLSearchParams(window.location.search);
        const cId = queryParams.get("customerId");
        const vId = queryParams.get("vehicleId");
        const reg = queryParams.get("reg");

        if (cId) setCustomerId(parseInt(cId));
        if (vId) setVehicleId(parseInt(vId));
        if (reg) setRegistration(reg.toUpperCase());
    }, []);

    useEffect(() => {
        if (lookupData?.vehicle) {
            setVehicleId(lookupData.vehicle.id);
            setRegistration(lookupData.vehicle.registration); // Sync with correct spacing
            setShowSuggestions(false);
            if (lookupData.customer) {
                setCustomerId(lookupData.customer.id);
            }
            if (lookupData.latestMileage) {
                setMileage(lookupData.latestMileage.toString());
            }
        }
    }, [lookupData]);

    const [generatingRichPDF, setGeneratingRichPDF] = useState(false);

    const handleDownloadRichPDF = async (docId: number) => {
        setGeneratingRichPDF(true);
        try {
            const result = await utils.serviceHistory.getRichPDF.fetch({ documentId: docId });
            if (result.content) {
                const link = document.createElement('a');
                link.href = `data:application/pdf;base64,${result.content}`;
                link.download = result.filename;
                link.click();
            }
        } catch (error: any) {
            toast.error("Failed to generate rich PDF: " + error.message);
        } finally {
            setGeneratingRichPDF(false);
        }
    };

    const createDoc = trpc.serviceHistory.create.useMutation({
        onSuccess: (data) => {
            toast.success("Document saved successfully");
            // Auto-trigger rich PDF download after save
            handleDownloadRichPDF(data.id);
        },
        onError: (err) => {
            toast.error("Failed to save document: " + err.message);
        }
    });

    const filteredVehicles = customerVehicles || [];
    const handleAddLine = (type: "Labour" | "Part") => {
        const newItem: LineItem = {
            id: Math.random().toString(),
            description: "",
            quantity: 1,
            unitPrice: 0,
            subNet: 0,
            itemType: type
        };
        if (type === "Labour") setLabourItems([...labourItems, newItem]);
        else setPartsItems([...partsItems, newItem]);
    };

    const handleRemoveLine = (id: string, type: "Labour" | "Part") => {
        if (type === "Labour") setLabourItems(labourItems.filter(item => item.id !== id));
        else setPartsItems(partsItems.filter(item => item.id !== id));
    };

    const handleUpdateLine = (id: string, type: "Labour" | "Part", field: keyof LineItem, value: any) => {
        const update = (items: LineItem[]) => items.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: value };
                if (field === "quantity" || field === "unitPrice") {
                    updated.subNet = Number(updated.quantity) * Number(updated.unitPrice);
                }
                return updated;
            }
            return item;
        });
        if (type === "Labour") setLabourItems(update(labourItems));
        else setPartsItems(update(partsItems));
    };

    const totalLabour = labourItems.reduce((acc, item) => acc + item.subNet, 0);
    const totalParts = partsItems.reduce((acc, item) => acc + item.subNet, 0);
    const subTotal = totalLabour + totalParts + Number(paintMaterials);
    const vat = subTotal * 0.2;
    const totalGross = subTotal + vat - Number(excess);

    const printRef = useRef<HTMLDivElement>(null);
    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `${docType === 'SI' ? 'Invoice' : 'Estimate'}_${docNo || 'Draft'}`,
    });

    const handleSave = async () => {
        if (!customerId || !vehicleId) {
            toast.error("Please select a customer and vehicle");
            return;
        }

        const items = [
            ...labourItems.filter(i => i.description),
            ...partsItems.filter(i => i.description)
        ].map(i => ({
            description: i.description,
            quantity: i.quantity.toString(),
            unitPrice: i.unitPrice.toString(),
            subNet: i.subNet.toString(),
            itemType: i.itemType
        }));

        createDoc.mutate({
            doc: {
                customerId,
                vehicleId,
                docType,
                docNo,
                dateCreated: new Date(dateCreated),
                totalNet: subTotal.toString(),
                totalTax: vat.toString(),
                totalGross: totalGross.toString(),
                mileage: parseInt(mileage) || 0,
                description: workDone
            },
            items
        });
    };

    return (
        <DashboardLayout>
            <div className="space-y-6 pb-20 max-w-[1400px] mx-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1 text-primary">
                            <FileText className="w-5 h-5" />
                            <span className="text-xs font-bold uppercase tracking-widest">Document Workspace</span>
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight">
                            {docType === 'SI' ? 'Job Invoice' : 'Repair Estimate'}
                        </h1>
                        <p className="text-muted-foreground text-sm">Professional document generation for automotive services</p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="lg"
                            className="h-12 border-blue-200 hover:bg-blue-50 text-blue-700 font-bold shadow-sm"
                            onClick={handlePrint}
                        >
                            <Printer className="w-5 h-5 mr-2" />
                            Print / PDF
                        </Button>
                        <Button
                            variant="outline"
                            size="lg"
                            className="h-12 border-orange-200 hover:bg-orange-50 text-orange-700 font-bold shadow-sm"
                            onClick={() => {
                                // This requires the doc to be saved first.
                                // If it's saved, we should have a documentId somewhere.
                                // For now, we'll let handleSave also trigger it.
                                toast.info("Click 'Store Document' to generate the professional Rich PDF");
                            }}
                            disabled={generatingRichPDF}
                        >
                            {generatingRichPDF ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
                            Rich PDF Export
                        </Button>
                        <Button
                            size="lg"
                            className="h-12 px-8 font-bold shadow-lg"
                            onClick={handleSave}
                            disabled={createDoc.isPending}
                        >
                            {createDoc.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
                            Store Document
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Sidebar - Meta & Selection */}
                    <div className="lg:col-span-4 space-y-6">
                        <Card className="border-primary/20 bg-primary/5 overflow-hidden shadow-md">
                            <CardHeader className="bg-primary/10 border-b border-primary/10">
                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                    <Car className="w-4 h-4" />
                                    Vehicle Snapshot
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-6 space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] text-primary font-black uppercase tracking-widest">Quick Lookup</Label>
                                    <div className="relative">
                                        <Input
                                            placeholder="ENTER REG"
                                            className="text-3xl font-black font-mono h-16 uppercase tracking-wider text-center border-2 border-primary/30 focus:border-primary bg-white shadow-inner"
                                            value={registration}
                                            onChange={e => {
                                                setRegistration(e.target.value.toUpperCase());
                                                setShowSuggestions(true);
                                            }}
                                            onFocus={() => setShowSuggestions(true)}
                                            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                        />
                                        {showSuggestions && suggestions && suggestions.length > 0 && registration.length >= 2 && (
                                            <div className="absolute z-50 w-full mt-1 bg-white border-2 border-primary/20 rounded-lg shadow-xl max-h-64 overflow-auto animate-in fade-in zoom-in-95">
                                                {suggestions.map(v => (
                                                    <div
                                                        key={v.id}
                                                        className="px-4 py-3 hover:bg-primary/5 cursor-pointer border-b last:border-0 transition-colors flex justify-between items-center group"
                                                        onClick={() => {
                                                            setRegistration(v.registration);
                                                            setShowSuggestions(false);
                                                        }}
                                                    >
                                                        <div>
                                                            <div className="font-black font-mono text-xl text-primary">{v.registration}</div>
                                                            <div className="text-[10px] text-muted-foreground font-bold uppercase">{v.make} {v.model}</div>
                                                        </div>
                                                        <Car className="w-5 h-5 text-primary/20 group-hover:text-primary transition-colors" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {isLookingUp && (
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground font-medium text-center">
                                        Type a registration to automatically pull all data
                                    </p>
                                </div>

                                {selectedVehicle && (
                                    <div className="bg-white/80 p-4 rounded-lg border border-primary/10 space-y-3 animate-in fade-in slide-in-from-top-2">
                                        <div className="flex justify-between items-start">
                                            <div className="bg-yellow-400 text-black px-3 py-1 rounded font-mono font-bold text-xl border-2 border-black inline-block shadow-sm">
                                                {selectedVehicle.registration}
                                            </div>
                                            {selectedVehicle.motExpiryDate && (
                                                <div className={cn(
                                                    "text-[10px] font-bold px-2 py-1 rounded border capitalize",
                                                    new Date(selectedVehicle.motExpiryDate) < new Date()
                                                        ? "bg-red-50 text-red-700 border-red-200"
                                                        : "bg-blue-50 text-blue-700 border-blue-200"
                                                )}>
                                                    MOT: {format(new Date(selectedVehicle.motExpiryDate), "dd/MM/yy")}
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="font-bold text-lg">{selectedVehicle.make} {selectedVehicle.model}</div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-2 uppercase tracking-tight">
                                                <Fuel className="w-3 h-3" />
                                                {selectedVehicle.fuelType || 'Unspecified'} • {selectedVehicle.colour || 'No Colour'}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 pt-2 border-t text-[10px]">
                                            <div>
                                                <p className="text-muted-foreground font-bold uppercase flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    Last Visit
                                                </p>
                                                <p className="font-bold text-slate-900">
                                                    {vehicleStats?.lastVisit ? format(new Date(vehicleStats.lastVisit), "dd MMM yyyy") : "First Visit"}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground font-bold uppercase flex items-center gap-1">
                                                    <History className="w-3 h-3" />
                                                    Total Jobs
                                                </p>
                                                <p className="font-bold text-slate-900">{vehicleStats?.totalJobs || 0} visits</p>
                                            </div>
                                        </div>

                                        {vehicleHistory.length > 0 && (
                                            <div className="pt-2 border-t">
                                                <Dialog>
                                                    <DialogTrigger asChild>
                                                        <Button variant="outline" size="sm" className="w-full text-[10px] h-7 bg-white hover:bg-slate-50 border-primary/20">
                                                            <History className="w-3 h-3 mr-2" />
                                                            View Previous History
                                                        </Button>
                                                    </DialogTrigger>
                                                    <DialogContent className="max-w-4xl sm:max-w-[85vw] max-h-[90vh] overflow-y-auto">
                                                        <DialogHeader>
                                                            <DialogTitle>Service History: {selectedVehicle.registration}</DialogTitle>
                                                        </DialogHeader>
                                                        <div className="mt-4">
                                                            <ServiceHistory vehicleId={selectedVehicle.id} />
                                                        </div>
                                                    </DialogContent>
                                                </Dialog>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-blue-500" />
                                    Document Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Type</Label>
                                        <Select value={docType} onValueChange={(val: any) => setDocType(val)}>
                                            <SelectTrigger className="h-9">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="SI">Invoice</SelectItem>
                                                <SelectItem value="ES">Estimate</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Number</Label>
                                        <Input className="h-9 font-mono font-bold" placeholder="89967" value={docNo} onChange={e => setDocNo(e.target.value)} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Issue Date</Label>
                                        <Input type="date" className="h-9" value={dateCreated} onChange={e => setDateCreated(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Account No</Label>
                                        <Input className="h-9 font-mono" placeholder="ADM001" value={accountNo} onChange={e => setAccountNo(e.target.value)} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Order Ref</Label>
                                        <Input className="h-9" value={orderRef} onChange={e => setOrderRef(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Payment Method</Label>
                                        <Input className="h-9" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                    <User className="w-4 h-4 text-blue-500" />
                                    Customer
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Select
                                    value={customerId?.toString()}
                                    onValueChange={(val) => {
                                        setCustomerId(parseInt(val));
                                        setVehicleId(null);
                                    }}
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Search customers..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {customers?.map(c => (
                                            <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {selectedCustomer && (
                                    <div className="bg-muted/30 p-3 rounded-md text-xs space-y-1 border border-dashed">
                                        <p className="font-bold">{selectedCustomer.name}</p>
                                        <p className="text-muted-foreground">{selectedCustomer.phone}</p>
                                        <p className="text-muted-foreground line-clamp-1">{selectedCustomer.address}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Rich technical intelligence for Document Generator */}
                        {selectedVehicle ? (
                            <Card className="border-blue-100 bg-blue-50/30 overflow-hidden">
                                <CardHeader className="py-3 bg-blue-100/50">
                                    <CardTitle className="text-xs font-bold flex items-center gap-2 text-blue-700">
                                        <Zap className="w-3.5 h-3.5 fill-blue-500 text-blue-500" />
                                        Technical Intelligence
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4 pb-4 space-y-3">
                                    {(selectedVehicle as any).comprehensiveTechnicalData ? (
                                        <div className="space-y-3">
                                            {(selectedVehicle as any).comprehensiveTechnicalData.lubricants && (
                                                <div className="flex gap-2 items-start">
                                                    <Droplet className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                                                    <div className="text-[11px]">
                                                        <p className="font-bold uppercase text-[9px] text-blue-600/70 tracking-tighter">Engine Oil Recommendation</p>
                                                        <p className="font-medium leading-tight">
                                                            {(selectedVehicle as any).comprehensiveTechnicalData.lubricants.find?.((l: any) => l.description?.includes('Engine'))?.specification || 'See full specs'}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {(selectedVehicle as any).comprehensiveTechnicalData.aircon && (
                                                <div className="flex gap-2 items-start">
                                                    <Thermometer className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" />
                                                    <div className="text-[11px]">
                                                        <p className="font-bold uppercase text-[9px] text-cyan-600/70 tracking-tighter">AC System Specification</p>
                                                        <p className="font-medium">
                                                            {(selectedVehicle as any).comprehensiveTechnicalData.aircon.type} ({(selectedVehicle as any).comprehensiveTechnicalData.aircon.quantity}g)
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            <Button
                                                variant="ghost"
                                                className="w-full text-[10px] h-8 text-blue-600 hover:text-blue-700 hover:bg-blue-100/50 border border-blue-100"
                                                onClick={() => setLocation(`/view-vehicle/${selectedVehicle.registration}`)}
                                            >
                                                Full technical report →
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <p className="text-[10px] text-muted-foreground text-center italic">No rich data available for this vehicle.</p>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="w-full text-[10px] h-8 bg-white"
                                                onClick={() => fetchTechData.mutate({ registration: selectedVehicle.registration })}
                                                disabled={fetchTechData.isPending}
                                            >
                                                {fetchTechData.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1 fill-blue-500 text-blue-500" />}
                                                Initialize Technical Hook
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ) : null}
                    </div>

                    {/* Work / Items Side */}
                    <div className="lg:col-span-8 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Job Description</CardTitle>
                                <CardDescription>Enter details of the work performed (one bullet or paragraph per line)</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    className="min-h-[150px]"
                                    placeholder="Investigated reported loss of power steering..."
                                    value={workDone}
                                    onChange={e => setWorkDone(e.target.value)}
                                />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle>Financial Summary</CardTitle>
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" className="h-8" onClick={() => handleAddLine("Labour")}>
                                        <Plus className="w-4 h-4 mr-1" /> Lab
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-8" onClick={() => handleAddLine("Part")}>
                                        <Plus className="w-4 h-4 mr-1" /> Part
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-6 pt-4">
                                {/* Labour Items */}
                                {labourItems.length > 0 && (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 text-blue-700">
                                            <span className="text-[10px] font-black uppercase tracking-widest">Labour Items</span>
                                            <div className="h-[1px] flex-1 bg-blue-100" />
                                        </div>
                                        <div className="space-y-2">
                                            {labourItems.map((item) => (
                                                <div key={item.id} className="grid grid-cols-12 gap-2 items-start bg-blue-50/30 p-2 rounded-lg border border-blue-100/50">
                                                    <div className="col-span-6">
                                                        <Input
                                                            placeholder="Description"
                                                            value={item.description}
                                                            onChange={(e) => handleUpdateLine(item.id, "Labour", "description", e.target.value)}
                                                            className="h-9 bg-white"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Input
                                                            type="number"
                                                            placeholder="Qty"
                                                            value={item.quantity}
                                                            onChange={(e) => handleUpdateLine(item.id, "Labour", "quantity", parseFloat(e.target.value) || 0)}
                                                            className="h-9 bg-white"
                                                        />
                                                    </div>
                                                    <div className="col-span-3">
                                                        <div className="relative">
                                                            <span className="absolute left-2 top-2.5 text-muted-foreground text-xs">£</span>
                                                            <Input
                                                                type="number"
                                                                placeholder="Price"
                                                                value={item.unitPrice}
                                                                onChange={(e) => handleUpdateLine(item.id, "Labour", "unitPrice", parseFloat(e.target.value) || 0)}
                                                                className="h-9 pl-5 bg-white font-mono"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="col-span-1 pt-1">
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleRemoveLine(item.id, "Labour")}>
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Parts Items */}
                                {partsItems.length > 0 && (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 text-orange-700">
                                            <span className="text-[10px] font-black uppercase tracking-widest">Parts Items</span>
                                            <div className="h-[1px] flex-1 bg-orange-100" />
                                        </div>
                                        <div className="space-y-2">
                                            {partsItems.map((item) => (
                                                <div key={item.id} className="grid grid-cols-12 gap-2 items-start bg-orange-50/30 p-2 rounded-lg border border-orange-100/50">
                                                    <div className="col-span-6">
                                                        <Input
                                                            placeholder="Part Description"
                                                            value={item.description}
                                                            onChange={(e) => handleUpdateLine(item.id, "Part", "description", e.target.value)}
                                                            className="h-9 bg-white"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Input
                                                            type="number"
                                                            placeholder="Qty"
                                                            value={item.quantity}
                                                            onChange={(e) => handleUpdateLine(item.id, "Part", "quantity", parseFloat(e.target.value) || 0)}
                                                            className="h-9 bg-white"
                                                        />
                                                    </div>
                                                    <div className="col-span-3">
                                                        <div className="relative">
                                                            <span className="absolute left-2 top-2.5 text-muted-foreground text-xs">£</span>
                                                            <Input
                                                                type="number"
                                                                placeholder="Price"
                                                                value={item.unitPrice}
                                                                onChange={(e) => handleUpdateLine(item.id, "Part", "unitPrice", parseFloat(e.target.value) || 0)}
                                                                className="h-9 pl-5 bg-white font-mono"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="col-span-1 pt-1">
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleRemoveLine(item.id, "Part")}>
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-6 pt-4 border-t border-dashed">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] uppercase font-bold text-blue-600">Paint & Materials (£)</Label>
                                        <Input
                                            type="number"
                                            value={paintMaterials}
                                            onChange={e => setPaintMaterials(parseFloat(e.target.value) || 0)}
                                            className="font-bold text-blue-700 bg-blue-50/50"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] uppercase font-bold text-red-600">Excess Deduction (£)</Label>
                                        <Input
                                            type="number"
                                            value={excess}
                                            onChange={e => setExcess(parseFloat(e.target.value) || 0)}
                                            className="font-bold text-red-700 bg-red-50/50"
                                        />
                                    </div>
                                </div>

                                <div className="pt-4 border-t space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">SubTotal (Net)</span>
                                        <span className="font-bold">£{subTotal.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">VAT (20%)</span>
                                        <span className="font-bold">£{vat.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-lg pt-2 border-t">
                                        <span className="font-black text-primary uppercase tracking-tight">Grand Total</span>
                                        <span className="font-black text-primary">£{totalGross.toFixed(2)}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>

            {/* Print Preview Hidden component */}
            <div style={{ display: "none" }}>
                <div ref={printRef} className="p-10 text-[#1e293b] bg-white min-h-[29.7cm] flex flex-col font-sans" style={{ width: '210mm' }}>
                    {/* CSS Overrides for print layout */}
                    <style>{`
                        @media print {
                            body { -webkit-print-color-adjust: exact; margin: 0; }
                            .print-container { padding: 40px; }
                        }
                        .invoice-container { background: white; }
                        .header-row { display: flex; justify-content: space-between; margin-bottom: 24px; }
                        .company-branding h1 { font-size: 32px; font-weight: 900; margin: 0; color: #000; letter-spacing: -0.01em; }
                        .company-branding p { margin: 1px 0; font-size: 11px; color: #334155; font-weight: 500; }
                        
                        .client-doc-split { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 40px; margin-bottom: 24px; }
                        .client-address p { margin: 1px 0; font-size: 11px; }
                        .client-name { font-size: 14px; font-weight: 800; margin-bottom: 4px !important; }

                        .doc-meta-table { font-size: 12px; width: 100%; text-align: right; }
                        .doc-title { font-size: 20px; font-weight: 900; text-transform: uppercase; margin-bottom: 4px; }
                        .meta-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 2px; }
                        .meta-label { color: #64748b; font-weight: 500; }
                        .meta-value { font-weight: 700; color: #0f172a; }

                        .blue-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
                        .blue-table th { background-color: #e7f1ff !important; color: #1e3a8a !important; padding: 6px 10px; text-align: left; font-weight: 700; border: 1px solid #bfdbfe; text-transform: uppercase; }
                        .blue-table td { padding: 8px 10px; border: 1px solid #bfdbfe; color: #1e293b; font-weight: 600; }

                        .items-section-header { background-color: #3b82f6 !important; color: white !important; padding: 4px 12px; font-weight: 800; text-transform: uppercase; font-size: 11px; margin-bottom: 0; }
                        .line-items-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
                        .line-items-table th { background-color: #f8fafc; padding: 6px 12px; text-align: left; font-weight: 700; border-bottom: 2px solid #e2e8f0; color: #475569; }
                        .line-items-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
                        .line-items-table .type-label { font-weight: 900; color: #1e3a8a; }

                        .job-desc-section h3 { font-size: 12px; font-weight: 800; border-bottom: 2px solid #000; display: inline-block; margin-bottom: 12px; text-transform: uppercase; }
                        .job-list { space-y: 1.5; font-size: 11px; }
                        .job-item { margin-bottom: 12px; }
                        .job-title { font-weight: 800; text-transform: uppercase; margin-bottom: 4px; display: block; }
                        .job-bullets { margin-left: 16px; list-style-type: disc; }
                        .job-bullets li { margin-bottom: 2px; }

                        .totals-block { align-self: flex-end; width: 280px; margin-top: auto; }
                        .totals-row { display: flex; justify-content: space-between; padding: 4px 8px; font-size: 11px; border: 1px solid #f1f5f9; }
                        .totals-row-bold { font-weight: 800; background-color: #f8fafc; border: 1px solid #e2e8f0; }
                        .grand-total-row { background-color: #e7f1ff !important; color: #1e3a8a !important; font-size: 14px; font-weight: 900; padding: 8px; margin-top: 4px; border: 2px solid #3b82f6; }
                    `}</style>

                    {/* 1. Company Header */}
                    <div className="header-row">
                        <div className="company-branding">
                            <h1>ELI MOTORS LIMITED</h1>
                            <p>49 VICTORIA ROAD, HENDON, LONDON, NW4 2RP</p>
                            <p>020 8203 6449, Sales 07950 250970</p>
                            <p>www.elimotors.co.uk</p>
                            <p style={{ marginTop: '4px', fontWeight: '800' }}>VAT 330 9339 65</p>
                        </div>
                        <div>
                            <img src="/logo.png" alt="Logo" className="h-24 w-auto" />
                        </div>
                    </div>

                    {/* 2. Addresses & Document Meta */}
                    <div className="client-doc-split">
                        <div className="client-address">
                            <p className="client-name">{selectedCustomer?.name || 'Customer Name'}</p>
                            <p className="whitespace-pre-line">{selectedCustomer?.address || 'Customer Address'}</p>
                            <p>{selectedCustomer?.postcode}</p>
                            <p style={{ marginTop: '12px' }}>Tel: {selectedCustomer?.phone}</p>
                        </div>
                        <div>
                            <div className="doc-meta-table">
                                <div className="doc-title">{docType === 'SI' ? 'Invoice' : 'Estimate'}</div>
                                <div style={{ fontSize: '20px', fontWeight: '900', marginBottom: '16px' }}>{docNo || 'DRAFT'}</div>
                                <div className="meta-row"><span className="meta-label">{docType === 'SI' ? 'Invoice' : 'Estimate'} Date:</span><span className="meta-value">{dateCreated ? format(new Date(dateCreated), "dd/MM/yyyy") : '-'}</span></div>
                                <div className="meta-row"><span className="meta-label">Account No:</span><span className="meta-value">{accountNo || `ELI${customerId || '00'}`}</span></div>
                                <div className="meta-row"><span className="meta-label">Order Ref:</span><span className="meta-value">{orderRef}</span></div>
                                <div className="meta-row"><span className="meta-label">Date of Work:</span><span className="meta-value">{dateCreated ? format(new Date(dateCreated), "dd/MM/yyyy") : '-'}</span></div>
                                <div className="meta-row"><span className="meta-label">Payment Member:</span><span className="meta-value">-</span></div>
                                <div className="meta-row"><span className="meta-label">Payment Method:</span><span className="meta-value">{paymentMethod}</span></div>
                            </div>
                        </div>
                    </div>

                    {/* 3. Vehicle Table */}
                    <table className="blue-table">
                        <thead>
                            <tr>
                                <th>Registration</th>
                                <th>Make</th>
                                <th>Model</th>
                                <th>Chassis Number</th>
                                <th>Mileage</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style={{ fontSize: '14px', fontWeight: '900' }}>{selectedVehicle?.registration || '-'}</td>
                                <td>{selectedVehicle?.make || '-'}</td>
                                <td>{selectedVehicle?.model || '-'}</td>
                                <td style={{ fontSize: '10px' }}>{selectedVehicle?.vin || '-'}</td>
                                <td style={{ fontSize: '14px', fontWeight: '900' }}>{mileage || '0'}</td>
                            </tr>
                            <tr>
                                <th>Engine No</th>
                                <th>Engine Code</th>
                                <th>Engine CC</th>
                                <th>Date Reg</th>
                                <th>Colour</th>
                            </tr>
                            <tr>
                                <td>{selectedVehicle?.engineNo || '-'}</td>
                                <td>{selectedVehicle?.engineCode || '-'}</td>
                                <td>{selectedVehicle?.engineCC || '-'}</td>
                                <td>{selectedVehicle?.dateOfRegistration ? format(new Date(selectedVehicle.dateOfRegistration), "dd/MM/yyyy") : '-'}</td>
                                <td>{selectedVehicle?.colour || '-'}</td>
                            </tr>
                        </tbody>
                    </table>

                    {/* 3.5 Technical Intelligence Reference (Internal/Print) */}
                    {(selectedVehicle as any)?.comprehensiveTechnicalData && (
                        <div style={{ marginBottom: '16px', padding: '10px', backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '4px' }}>
                            <div style={{ fontSize: '10px', fontWeight: '900', color: '#0369a1', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
                                Technical Reference (Source: UKVD/SWS)
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                                <div>
                                    <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Engine Oil Spec</div>
                                    <div style={{ fontSize: '11px', fontWeight: '700' }}>
                                        {(selectedVehicle as any).comprehensiveTechnicalData.lubricants?.find?.((l: any) => l.description?.toLowerCase().includes('engine oil'))?.specification || 'Refer to Manual'}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Oil Capacity</div>
                                    <div style={{ fontSize: '11px', fontWeight: '700' }}>
                                        {(selectedVehicle as any).comprehensiveTechnicalData.lubricants?.find?.((l: any) => l.description?.toLowerCase().includes('engine oil'))?.capacity || 'N/A'}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '9px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Aircon System</div>
                                    <div style={{ fontSize: '11px', fontWeight: '700' }}>
                                        {(selectedVehicle as any).comprehensiveTechnicalData.aircon
                                            ? `${(selectedVehicle as any).comprehensiveTechnicalData.aircon.type} (${(selectedVehicle as any).comprehensiveTechnicalData.aircon.quantity})`
                                            : 'N/A'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 4. Job Description */}
                    <div className="job-desc-section">
                        <h3>Job Description</h3>
                        <div className="job-list">
                            {workDone.split('\n\n').map((block, bi) => {
                                const lines = block.split('\n');
                                const title = lines[0];
                                const bullets = lines.slice(1);
                                return (
                                    <div key={bi} className="job-item">
                                        <span className="job-title">{title}</span>
                                        {bullets.length > 0 && (
                                            <ul className="job-bullets">
                                                {bullets.map((b, li) => <li key={li}>{b.replace(/^[•\-\*]\s*/, '')}</li>)}
                                            </ul>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 5. Labor & Parts Tables */}
                    <div style={{ marginTop: '20px' }}>
                        {labourItems.filter(i => i.description).length > 0 && (
                            <table className="line-items-table">
                                <thead>
                                    <tr>
                                        <th style={{ backgroundColor: '#e7f1ff', color: '#1e3a8a', width: '50%' }}>Labour</th>
                                        <th style={{ textAlign: 'center' }}>Qty</th>
                                        <th style={{ textAlign: 'right' }}>Unit</th>
                                        <th style={{ textAlign: 'center' }}>D</th>
                                        <th style={{ textAlign: 'right', width: '20%' }}>Sub Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {labourItems.filter(i => i.description).map((item, id) => (
                                        <tr key={id}>
                                            <td style={{ fontWeight: '500' }}>{item.description}</td>
                                            <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                                            <td style={{ textAlign: 'right' }}>{item.unitPrice.toFixed(2)}</td>
                                            <td style={{ textAlign: 'center' }}>-</td>
                                            <td style={{ textAlign: 'right', fontWeight: '700' }}>{item.subNet.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}

                        {partsItems.filter(i => i.description).length > 0 && (
                            <table className="line-items-table">
                                <thead>
                                    <tr>
                                        <th style={{ backgroundColor: '#fff7ed', color: '#9a3412', width: '50%' }}>Parts</th>
                                        <th style={{ textAlign: 'center' }}>Qty</th>
                                        <th style={{ textAlign: 'right' }}>Unit</th>
                                        <th style={{ textAlign: 'center' }}>D</th>
                                        <th style={{ textAlign: 'right', width: '20%' }}>Sub Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {partsItems.filter(i => i.description).map((item, id) => (
                                        <tr key={id}>
                                            <td style={{ fontWeight: '500' }}>{item.description}</td>
                                            <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                                            <td style={{ textAlign: 'right' }}>{item.unitPrice.toFixed(2)}</td>
                                            <td style={{ textAlign: 'center' }}>-</td>
                                            <td style={{ textAlign: 'right', fontWeight: '700' }}>{item.subNet.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* 6. Totals Section */}
                    <div className="totals-block">
                        <div className="totals-row"><span className="meta-label">Labour</span><span className="meta-value">{totalLabour.toFixed(2)}</span></div>
                        <div className="totals-row"><span className="meta-label">Parts</span><span className="meta-value">{totalParts.toFixed(2)}</span></div>
                        {paintMaterials > 0 && (
                            <div className="totals-row"><span className="meta-label">Paint & Mat.</span><span className="meta-value">{Number(paintMaterials).toFixed(2)}</span></div>
                        )}
                        <div className="totals-row totals-row-bold"><span className="meta-label">SubTotal</span><span className="meta-value">{subTotal.toFixed(2)}</span></div>
                        <div className="totals-row"><span className="meta-label">VAT (20%)</span><span className="meta-value">{vat.toFixed(2)}</span></div>
                        {excess > 0 && (
                            <div className="totals-row" style={{ color: '#dc2626' }}><span className="meta-label">Less Excess</span><span className="meta-value">-{Number(excess).toFixed(2)}</span></div>
                        )}
                        <div className="grand-total-row">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase' }}>Total</span>
                                <span>£{totalGross.toFixed(2)}</span>
                            </div>
                        </div>
                        <div className="totals-row" style={{ border: 'none', marginTop: '4px' }}>
                            <span className="meta-label" style={{ fontWeight: '800' }}>Balance</span>
                            <span className="meta-value" style={{ fontSize: '14px' }}>£{totalGross.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Footer */}
                    <div style={{ marginTop: 'auto', paddingTop: '40px', textAlign: 'center', fontSize: '10px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Thank you for your business. ELI MOTORS LIMITED
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

