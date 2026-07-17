import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Car,
    User,
    Calendar,
    History,
    ArrowLeft,
    AlertCircle,
    ShieldCheck,
    Fuel,
    FileText,
    Zap,
    Loader2,
    Droplet,
    Thermometer,
    Wrench,
    AlertTriangle,
    Copy,
    Check,
    ExternalLink,
    Sparkles,
    ShieldAlert,
    Banknote,
    Gauge,
    CheckCircle2,
    Search,
    X
} from "lucide-react";
import { Link, useParams, useLocation } from "wouter";
import { useClassicBase } from "@/lib/classicNav";
import { ga4Spaced } from "@/components/RegPlate";
import DashboardLayout from "@/components/DashboardLayout";
import { formatMOTDate, getMOTStatusBadge } from "@/lib/motUtils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner"; // Added toast import
import { ManufacturerLogo } from "@/components/ManufacturerLogo";
import { ServiceHistory } from "@/components/ServiceHistory";
import { AutodataQRDialog } from "@/components/AutodataQRDialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Smartphone, QrCode } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// SWS returns engine oil as one row per ACEA/API/ILSAC standard (8+ rows that differ only by
// grade). Condense to the distinct SAE grades (preferred first) + capacity; dedupe other fluids.
function LubricantsSummary({ lubricants }: { lubricants: any[] }) {
    const lubes = Array.isArray(lubricants) ? lubricants : [];
    const fmtCap = (cap: any) => { const v = String(cap ?? "").replace(/\s*\(l\)\s*/i, "").trim(); return v ? `${v} L` : ""; };
    const isOil = (l: any) => /ENGINE OIL/i.test(String(l?.description || ""));
    const gradeOf = (s: any) => (String(s).match(/\b\d+W[-\s]?\d+\b/i) || [])[0]?.toUpperCase().replace(/\s+/g, "") || String(s || "").trim();
    const oils = lubes.filter(isOil);
    const prefG = Array.from(new Set(oils.filter((o) => /PREFERRED/i.test(o?.description || "")).map((o) => gradeOf(o.specification)).filter(Boolean)));
    const allG = Array.from(new Set(oils.map((o) => gradeOf(o.specification)).filter(Boolean)));
    const oilGrades = [...prefG, ...allG.filter((g) => !prefG.includes(g))];
    const oilCap = oils.find((o) => o?.capacity)?.capacity;
    const seen = new Set<string>();
    const others = lubes.filter((l) => !isOil(l)).filter((l) => { const k = `${l?.description}|${l?.specification}`; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!lubes.length) return <p className="text-sm text-muted-foreground italic">Specifications available in technical documents</p>;
    return (
        <div className="space-y-3">
            {oils.length > 0 && (
                <div className="text-sm">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Engine Oil</p>
                    <p className="font-bold">
                        {oilGrades.length ? oilGrades.map((g, i) => (
                            <span key={i}>{i > 0 && <span className="text-muted-foreground font-normal"> · </span>}{g}{prefG.includes(g) && oilGrades.length > 1 && <span className="text-[10px] text-blue-600 font-medium"> (preferred)</span>}</span>
                        )) : (oils[0]?.specification || "N/A")}
                    </p>
                    {oilCap && <p className="text-xs text-primary font-bold mt-0.5">Capacity: {fmtCap(oilCap)}</p>}
                </div>
            )}
            {others.map((l: any, i: number) => (
                <div key={i} className="text-sm">
                    <p className="text-xs font-medium text-muted-foreground uppercase">{String(l?.description || "Fluid").replace(/\s*\(LUBRICANT SPECIFICATION\)/i, "").trim()}</p>
                    <p className="font-bold">{l?.specification || "N/A"}</p>
                    {l?.capacity && <p className="text-xs text-primary font-bold mt-0.5">Capacity: {fmtCap(l.capacity)}</p>}
                </div>
            ))}
        </div>
    );
}

// Tabbed workshop history for a vehicle: full service timeline, every part fitted, and the
// MOT test history with advisories — mirrors how a job sheet is laid out.
function VehicleHistoryTabs({ vehicleId, registration }: { vehicleId: number; registration: string }) {
    const parts = trpc.documents.partsHistory.useQuery({ vehicleId }, { staleTime: 60_000 });
    const mot = trpc.documents.motTests.useQuery({ registration }, { enabled: !!registration, staleTime: 5 * 60_000 });
    const fmt = (d: any) => { if (!d) return "-"; const s = String(d).replace(/\./g, "-").replace(" ", "T"); const dt = new Date(s); return isNaN(dt.getTime()) ? String(d).slice(0, 10) : dt.toLocaleDateString("en-GB"); };
    const partsN = parts.data?.length ?? 0, motN = mot.data?.length ?? 0;
    return (
        <Tabs defaultValue="history">
            <TabsList>
                <TabsTrigger value="history">Service History</TabsTrigger>
                <TabsTrigger value="parts">Parts{partsN ? ` (${partsN})` : ""}</TabsTrigger>
                <TabsTrigger value="mot">MOT History{motN ? ` (${motN})` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="history" className="mt-4">
                <ServiceHistory vehicleId={vehicleId} />
            </TabsContent>

            <TabsContent value="parts" className="mt-4">
                {parts.isLoading ? (
                    <p className="text-center py-8 text-muted-foreground text-sm">Loading parts…</p>
                ) : partsN === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><Wrench className="w-10 h-10 mx-auto mb-3 opacity-50" /><p>No parts recorded for this vehicle</p></div>
                ) : (
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Date</TableHead><TableHead>Part</TableHead><TableHead>Part No.</TableHead>
                            <TableHead>Doc</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {parts.data!.map((p: any) => (
                                <TableRow key={p.id}>
                                    <TableCell className="whitespace-nowrap text-sm">{fmt(p.dateIssued || p.dateCreated)}</TableCell>
                                    <TableCell className="text-sm">{p.description}</TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">{p.partNumber || "-"}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{p.docNo}</TableCell>
                                    <TableCell className="text-right text-sm">{Number(p.quantity || 0)}</TableCell>
                                    <TableCell className="text-right text-sm">£{Number(p.unitPrice || 0).toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </TabsContent>

            <TabsContent value="mot" className="mt-4">
                {mot.isLoading ? (
                    <p className="text-center py-8 text-muted-foreground text-sm">Loading MOT history…</p>
                ) : motN === 0 ? (
                    <div className="text-center py-12 text-muted-foreground"><ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-50" /><p>No MOT history found</p></div>
                ) : (
                    <div className="space-y-3">
                        {mot.data!.map((t: any, i: number) => (
                            <div key={i} className="border border-border rounded-lg p-3">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <Badge variant={t.testResult === "PASSED" ? "default" : "destructive"} className={t.testResult === "PASSED" ? "bg-green-100 text-green-800" : ""}>{t.testResult}</Badge>
                                        <span className="text-sm font-medium">{fmt(t.completedDate)}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {t.odometerValue ? `${Number(t.odometerValue).toLocaleString("en-GB")} ${t.odometerUnit === "KM" ? "km" : "mi"}` : ""}
                                        {t.expiryDate ? `  ·  expires ${fmt(t.expiryDate)}` : ""}
                                    </div>
                                </div>
                                {t.defects?.length > 0 && (
                                    <ul className="mt-2 space-y-1 border-t border-border pt-2">
                                        {t.defects.map((d: any, j: number) => (
                                            <li key={j} className={`text-xs flex gap-2 ${d.dangerous ? "text-red-600" : /ADVISORY/i.test(d.type) ? "text-amber-600" : "text-slate-600"}`}>
                                                <span className="font-semibold uppercase shrink-0 w-16">{d.dangerous ? "Dangerous" : d.type}</span>
                                                <span>{d.text}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </TabsContent>
        </Tabs>
    );
}

export default function VehicleDetails() {
    // We try to get the registration from the URL parameter "registration"
    const params = useParams<{ registration: string }>();
    console.log("VehicleDetails: params received:", params);
    const registration = params.registration ? decodeURIComponent(params.registration) : "";
    console.log("VehicleDetails: registration detected from URL:", registration);

    const [, setLocation] = useLocation(); // Added
    const base = useClassicBase();
    const utils = trpc.useUtils(); // Added

    const { data: result, isLoading } = trpc.vehicles.getByRegistration.useQuery(
        { registration: registration || "" },
        { enabled: !!registration }
    );

    const vehicle = result?.vehicle;
    const customer = result?.customer;
    const reminders = result?.reminders || [];
    const history = result?.history || [];

    const [rightTab, setRightTab] = useState<"General" | "Specs" | "Extra" | "Features" | "Notes">("General");
    const [historyTab, setHistoryTab] = useState<"issued" | "parts" | "reminders">("issued");
    const partsHistory = trpc.documents.partsHistory.useQuery({ vehicleId: vehicle?.id as number }, { enabled: !!vehicle?.id && historyTab === "parts", staleTime: 60_000 });

    // Added fetchTechnicalData mutation
    const fetchTechData = trpc.vehicles.fetchTechnicalData.useMutation({
        onSuccess: () => {
            toast.success("Rich technical data updated!");
            utils.vehicles.getByRegistration.invalidate();
        },
        onError: (err) => {
            toast.error("Failed to fetch tech specs: " + err.message);
        }
    });

    const syncUKVDMutation = trpc.vehicles.syncUKVD.useMutation({
        onSuccess: () => {
            toast.success("Premium Technical Data updated!");
            utils.vehicles.getByRegistration.invalidate();
        },
        onError: (err) => {
            toast.error("Failed to fetch premium data: " + err.message);
        }
    });

    // Detach the current owner from this vehicle (e.g. they've sold it). The vehicle
    // and its history stay on the system; it just becomes ownerless until reassigned.
    const unlinkOwner = trpc.reminders.unlinkVehicle.useMutation({
        onSuccess: () => {
            toast.success("Owner removed from this vehicle.");
            utils.vehicles.getByRegistration.invalidate();
        },
        onError: (err) => {
            toast.error("Failed to remove owner: " + err.message);
        }
    });

    const deleteVehicle = trpc.database.delete.useMutation({
        onSuccess: () => {
            toast.success("Vehicle deleted.");
            setLocation(`${base}/vehicles`);
        },
        onError: (err: any) => {
            toast.error("Failed to delete vehicle: " + err.message);
        }
    });

    const soon = (label: string) => () => toast.message(`${label} isn't available in Classic view yet.`);
    const money = (v: any) => (v == null || v === "" || Number(v) === 0 ? "" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    const formatDate = (date: Date | string | null) => {
        if (!date) return "-";
        return new Date(date).toLocaleDateString("en-GB");
    };

    if (isLoading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <div className="text-muted-foreground animate-pulse flex items-center gap-2">
                        <Car className="w-6 h-6 animate-bounce" />
                        Loading vehicle details...
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (!vehicle) {
        return (
            <DashboardLayout>
                <div className="p-8 text-center bg-card rounded-xl border-2 border-dashed">
                    <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                    <h2 className="text-xl font-bold">Vehicle Not Found</h2>
                    <p className="text-muted-foreground mb-6">Could not find vehicle with registration: {registration}</p>
                    <Link href={`${base}/vehicles`}>
                        <Button variant="outline">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Vehicles
                        </Button>
                    </Link>
                </div>
            </DashboardLayout>
        );
    }

    const motInfo = formatMOTDate(vehicle.motExpiryDate);
    const motBadge = getMOTStatusBadge(motInfo);

    const jobSummaryUrl = `${window.location.protocol}//${window.location.host}/mobile/job/${vehicle.id}`;

    if (base) {
        const altMobile = Array.isArray(customer?.altContacts) ? (customer!.altContacts as any[])[0]?.phone : undefined;
        const CHECKBOX_FLAGS_LEFT = ["Air Conditioning", "Power Steering", "ABS Brakes", "Traction Control", "Pollen Filter"];
        const CHECKBOX_FLAGS_RIGHT = ["Solid Discs", "Vented Discs", "Rear Shoes & Cylinders", "Rear Discs", "Timing Chain"];
        const HISTORY_TABS: { key: "issued" | "parts" | "reminders" | null; label: string }[] = [
            { key: "issued", label: "Issued Docs" },
            { key: null, label: "Other Docs" },
            { key: null, label: "Appointments" },
            { key: null, label: "All Labour" },
            { key: "parts", label: "All Parts" },
            { key: null, label: "All Advisories" },
            { key: "reminders", label: "Reminders" },
            { key: null, label: "Overview" },
        ];
        return (
            <DashboardLayout>
                <div className="vd-page">
                <div className="vd-body">
                    <div className="js-titlebar" style={{ background: "linear-gradient(90deg, #5c5c5c 0%, #464646 58%, #3a3a3a 100%)" }}>
                        <div>
                            <span className="text-amber-300">★</span>
                            <strong>Vehicle Details:</strong>
                            <span className="text-white/80 vd-title-text" title={`${ga4Spaced(vehicle.registration || "")} - ${vehicle.make as string} ${vehicle.model as string}${(vehicle as any).derivative ? ` ${(vehicle as any).derivative}` : ""}`}>{ga4Spaced(vehicle.registration || "")} - {vehicle.make as string} {vehicle.model as string}{(vehicle as any).derivative ? ` ${(vehicle as any).derivative}` : ""}</span>
                        </div>
                        <button type="button" className="js-notice" onClick={soon("Notice")}>Notice</button>
                        <div className="js-window-controls">
                            <button type="button" onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation(`${base}/vehicles`); }} title="Close"><X className="w-4 h-4" /></button>
                        </div>
                    </div>

                    <nav className="js-primary-actions">
                        <button className="js-action-button" onClick={soon("Save")}>Save</button>
                        <button className="js-action-button" onClick={() => setLocation(`${base}/documents/new?reg=${encodeURIComponent(vehicle.registration as string)}&docType=JS`)}>New Doc</button>
                        <button className="js-action-button" onClick={() => customer && setLocation(`${base}/customers/${customer.id}`)} disabled={!customer}>View Owner</button>
                        <button className="js-action-button" onClick={soon("Print")}>Print</button>
                        <button className="js-action-button" onClick={soon("History")}>History</button>
                        <button className="js-action-button" onClick={soon("Attachments")}>Attachments</button>
                        <button className="js-action-button" onClick={soon("Tech Data")}>Tech Data</button>
                        <button className="js-action-button" onClick={() => setLocation(`/mot-check?reg=${encodeURIComponent(vehicle.registration as string)}`)}>MOT Check</button>
                        <span className="js-action-spacer" />
                        <button
                            className="js-action-button"
                            disabled={deleteVehicle.isPending}
                            onClick={() => {
                                if (window.confirm(`Delete ${vehicle.registration}? This removes the vehicle record — its service history stays on the system.`)) {
                                    deleteVehicle.mutate({ vehicleIds: [vehicle.id as number] });
                                }
                            }}
                        >
                            Delete
                        </button>
                    </nav>

                    <div className="vd-main">
                        <div className="vd-specs">
                            <div className="js-lookup-row">
                                <span>Registration</span>
                                <div className="js-combo-field">
                                    <input readOnly value={ga4Spaced(vehicle.registration || "")} className="bg-yellow-50 font-mono font-semibold" />
                                    <span className="js-combo-arrow" aria-hidden="true">▾</span>
                                    <button type="button" className="js-combo-clear" disabled aria-label="Clear registration"><X className="w-3 h-3" /></button>
                                </div>
                                <div style={{ display: "flex", gap: 4 }}>
                                    <button type="button" className="js-search-button" onClick={soon("VRM Lookup")}>
                                        <span className="js-search-icon"><Search className="w-3.5 h-3.5" /></span>
                                        <span className="js-search-label">VRM Lookup</span>
                                    </button>
                                    <button type="button" className="js-search-button" onClick={soon("VRM Transfer")}>
                                        <span className="js-search-label">VRM Transfer</span>
                                    </button>
                                </div>
                            </div>
                            <label className="js-field"><span>Make / Model</span>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <input readOnly value={(vehicle.make as string) || ""} />
                                    <input readOnly value={(vehicle.model as string) || ""} />
                                </div>
                            </label>
                            <label className="js-field"><span>Derivative</span><input readOnly value={(vehicle as any).derivative || ""} /></label>
                            <label className="js-field"><span>Chassis Number</span><input readOnly value={vehicle.vin || ""} /></label>
                            <label className="js-field"><span>Engine CC</span>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <input readOnly value={vehicle.engineCC || ""} />
                                    <span style={{ alignSelf: "center", fontSize: 12, color: "#555", flexShrink: 0 }}>Fuel Type</span>
                                    <input readOnly value={(vehicle.fuelType as string) || ""} />
                                </div>
                            </label>
                            <label className="js-field"><span>Engine Code</span>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <input readOnly value={(vehicle as any).engineCode || ""} />
                                    <span style={{ alignSelf: "center", fontSize: 12, color: "#555", flexShrink: 0 }}>Engine No</span>
                                    <input readOnly value={(vehicle as any).engineNo || ""} />
                                </div>
                            </label>
                            <label className="js-field"><span>Colour</span>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <input readOnly value={(vehicle.colour as string) || ""} />
                                    <span style={{ alignSelf: "center", fontSize: 12, color: "#555", flexShrink: 0 }}>Paint Code</span>
                                    <input readOnly value={(vehicle as any).paintCode || ""} />
                                </div>
                            </label>
                            <label className="js-field"><span>Key Code</span>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <input readOnly value={(vehicle as any).keyCode || ""} />
                                    <span style={{ alignSelf: "center", fontSize: 12, color: "#555", flexShrink: 0 }}>Radio Code</span>
                                    <input readOnly value={(vehicle as any).radioCode || ""} />
                                </div>
                            </label>
                            <label className="js-field"><span>Date Manufactured</span>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <input readOnly value={formatDate(vehicle.dateOfRegistration)} />
                                    <span style={{ alignSelf: "center", fontSize: 12, color: "#555", flexShrink: 0 }}>Date Reg</span>
                                    <input readOnly value={formatDate(vehicle.dateOfRegistration)} />
                                </div>
                            </label>
                            {/* Tyre size/depth aren't tracked in the schema yet — shown for visual
                                fidelity with the reference, not persisted. */}
                            <div className="vd-tyres">
                                <span>Tyre Size</span>
                                <input placeholder="Front" />
                                <input placeholder="Rear" />
                                <span>Tyre Depth</span>
                                <input placeholder="Front" />
                                <input placeholder="Rear" />
                            </div>
                        </div>

                        <div className="vd-owner-panel">
                            <div className="js-history-tabs">
                                {(["General", "Specs", "Extra", "Features", "Notes"] as const).map((t) => (
                                    <button key={t} type="button" className={rightTab === t ? "active" : ""} onClick={() => setRightTab(t)}>{t}</button>
                                ))}
                            </div>
                            <div className="vd-owner-body">
                                {rightTab === "General" ? (
                                    <>
                                        <div className="vd-stock-row">
                                            <span>Used Vehicle Stock</span>
                                            <div className="vd-yn-toggle">
                                                <button type="button" onClick={soon("Used Vehicle Stock")}>Y</button>
                                                <button type="button" className="on" onClick={soon("Used Vehicle Stock")}>N</button>
                                            </div>
                                            <span style={{ marginLeft: 12 }}>Owner</span>
                                            <div className="vd-owner-actions">
                                                <button type="button" className="ga4-btn" disabled={!customer} onClick={() => customer && setLocation(`${base}/customers/${customer.id}`)}>View</button>
                                                <button type="button" className="ga4-btn" onClick={soon("Change owner")}>Change</button>
                                                <button
                                                    type="button"
                                                    className="ga4-btn"
                                                    disabled={!customer || unlinkOwner.isPending}
                                                    onClick={() => {
                                                        if (customer && window.confirm(`Remove ${customer.name} as the owner of ${vehicle.registration}?\n\nThe vehicle and its full service history stay on the system — it just becomes unassigned.`)) {
                                                            unlinkOwner.mutate({ vehicleId: vehicle.id as number });
                                                        }
                                                    }}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                        <label className="js-field"><span>Acc Number</span><input readOnly value={customer?.accountNumber || ""} /></label>
                                        <label className="js-field"><span>Name</span><input readOnly value={customer?.name || ""} /></label>
                                        <label className="js-field"><span>Telephone</span><input readOnly value={customer?.phone || ""} /></label>
                                        <label className="js-field"><span>Mobile</span><input readOnly value={altMobile || ""} /></label>
                                        <div className="vd-checkbox-grid">
                                            {CHECKBOX_FLAGS_LEFT.map((f) => (
                                                <label key={f}><input type="checkbox" disabled /> {f}</label>
                                            ))}
                                            {CHECKBOX_FLAGS_RIGHT.map((f) => (
                                                <label key={f}><input type="checkbox" disabled /> {f}</label>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <p className="vd-placeholder">{rightTab} isn't available in Classic view yet.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="vd-history-panel">
                        <div className="js-history-tabs">
                            {HISTORY_TABS.map((t) => (
                                <button
                                    key={t.label}
                                    type="button"
                                    className={t.key && historyTab === t.key ? "active" : ""}
                                    onClick={t.key ? () => setHistoryTab(t.key as "issued" | "parts" | "reminders") : soon(t.label)}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <div className="vd-history-body">
                        {historyTab === "issued" && (
                            history.length === 0 ? <div className="js-history-empty" /> : (
                                <>
                                    <div className="js-history-table-head vd-doc-row">
                                        <span>Date</span><span>Doc No</span><span>Acc Number</span><span>Customer</span><span>Description</span><span>Mileage</span><span>Total</span><span>Receipts</span><span>Balance</span><span></span>
                                    </div>
                                    {history.map((d: any) => (
                                        <button key={d.id} type="button" className="vd-doc-row" onClick={() => setLocation(`${base}/documents/${d.id}`)}>
                                            <span>{formatDate(d.dateIssued || d.dateCreated)}</span>
                                            <span>{d.docType} {d.docNo}</span>
                                            <span>{d.accountNumber || ""}</span>
                                            <span>{d.customerName || ""}</span>
                                            <span>{d.mainDescription || ""}</span>
                                            <span className="vd-num">{d.mileage ? Number(d.mileage).toLocaleString("en-GB") : ""}</span>
                                            <span className="vd-num">{money(d.totalGross)}</span>
                                            <span>{d.paymentMethods || ""}</span>
                                            <span className="vd-num">{money(d.balance)}</span>
                                            <span className="vd-open-btn">Open</span>
                                        </button>
                                    ))}
                                </>
                            )
                        )}
                        {historyTab === "parts" && (
                            partsHistory.isFetching && !partsHistory.data ? <div className="js-history-empty" /> :
                            !partsHistory.data?.length ? <div className="js-history-empty" /> : (
                                <>
                                    <div className="js-history-table-head vd-doc-row" style={{ gridTemplateColumns: "82px 1fr 100px 76px 60px 76px" }}>
                                        <span>Date</span><span>Part</span><span>Part No.</span><span>Doc</span><span>Qty</span><span>Price</span>
                                    </div>
                                    {partsHistory.data!.map((p: any) => (
                                        <div key={p.id} className="vd-doc-row" style={{ gridTemplateColumns: "82px 1fr 100px 76px 60px 76px", height: 23, background: "#fff", borderBottom: "1px solid #ddd", fontSize: 12 }}>
                                            <span>{formatDate(p.dateIssued || p.dateCreated)}</span>
                                            <span>{p.description}</span>
                                            <span>{p.partNumber || ""}</span>
                                            <span>{p.docNo}</span>
                                            <span className="vd-num">{Number(p.quantity || 0)}</span>
                                            <span className="vd-num">{money(p.unitPrice)}</span>
                                        </div>
                                    ))}
                                </>
                            )
                        )}
                        {historyTab === "reminders" && (
                            reminders.length === 0 ? <div className="js-history-empty" /> : (
                                <>
                                    <div className="js-history-table-head vd-doc-row" style={{ gridTemplateColumns: "1fr 100px 100px 100px 100px" }}>
                                        <span>Type</span><span>Due Date</span><span>Status</span><span>Sent At</span><span>Method</span>
                                    </div>
                                    {reminders.map((r: any) => (
                                        <div key={r.id} className="vd-doc-row" style={{ gridTemplateColumns: "1fr 100px 100px 100px 100px", height: 23, background: "#fff", borderBottom: "1px solid #ddd", fontSize: 12 }}>
                                            <span>{r.type}</span>
                                            <span>{formatDate(r.dueDate)}</span>
                                            <span>{r.status}</span>
                                            <span>{formatDate(r.sentAt)}</span>
                                            <span>{r.sentMethod || ""}</span>
                                        </div>
                                    ))}
                                </>
                            )
                        )}
                        </div>
                    </div>
                </div>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <button
                    onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation("/sales-stock"); }}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> Back
                </button>
                {/* Header with Logo */}
                <div className="bg-card p-6 rounded-xl border border-border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <ManufacturerLogo make={vehicle.make as string} size="xl" />
                        <div>
                            <div className="bg-yellow-400 text-black px-4 py-1 rounded font-mono font-bold text-2xl border-2 border-black inline-block shadow-sm">
                                {vehicle.registration}
                            </div>
                            <h1 className="text-2xl font-bold mt-2">
                                {vehicle.make as string} {vehicle.model as string}
                            </h1>
                            <p className="text-muted-foreground flex items-center gap-2">
                                <Fuel className="w-4 h-4" />
                                {(vehicle.fuelType as string) || "Unknown"} • {(vehicle.colour as string)} • {vehicle.engineCC ? `${vehicle.engineCC}cc` : "Unknown Size"}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 min-w-[200px]">
                        <Button
                            onClick={() => setLocation(`${base}/documents/new?reg=${encodeURIComponent(vehicle.registration)}&docType=JS`)}
                        >
                            <FileText className="w-4 h-4 mr-2" />
                            New Job Sheet
                        </Button>
                        <Button
                            variant="outline"
                            className="bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
                            onClick={() => setLocation(`${base}/documents/new?reg=${encodeURIComponent(vehicle.registration)}&docType=SI`)}
                        >
                            <FileText className="w-4 h-4 mr-2" />
                            Create Estimate/Invoice
                        </Button>
                        <Button
                            variant="outline"
                            disabled={fetchTechData.isPending || syncUKVDMutation.isPending}
                            onClick={() => {
                                fetchTechData.mutate({ registration: vehicle.registration });
                                syncUKVDMutation.mutate({ registration: vehicle.registration });
                            }}
                            className={vehicle.vin ? "" : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"}
                        >
                            {fetchTechData.isPending || syncUKVDMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2 text-yellow-500 fill-yellow-500" />}
                            Fetch Premium Data
                        </Button>
                    </div>
                    <div className="flex flex-col gap-2 min-w-[200px]">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="bg-green-600 hover:bg-green-700 text-white font-bold">
                                    <Smartphone className="w-4 h-4 mr-2" />
                                    Send to Mobile
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md text-center flex flex-col items-center">
                                <DialogHeader>
                                    <DialogTitle className="text-center">Job Summary Mobile Link</DialogTitle>
                                    <DialogDescription className="text-center">
                                        Scan this QR code with your phone camera to instantly open the job summary and navigation directions.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="p-6 bg-white rounded-xl shadow-inner border border-slate-100 flex items-center justify-center">
                                    {/* Using a widely available QR code generation API without needing explicit package install */}
                                    <img
                                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(jobSummaryUrl)}`}
                                        alt="QR Code"
                                        className="w-48 h-48 pointer-events-none"
                                    />
                                </div>
                                <div className="flex w-full gap-2 mt-4">
                                    <Button
                                        onClick={() => {
                                            navigator.clipboard.writeText(jobSummaryUrl);
                                            toast.success("Mobile link copied to clipboard");
                                        }}
                                        variant="outline"
                                        className="flex-1"
                                    >
                                        <Copy className="w-4 h-4 mr-2" />
                                        Copy Link
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            window.open(`sms:?&body=${encodeURIComponent(`Job Summary: ${jobSummaryUrl}`)}`, '_blank');
                                        }}
                                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                                    >
                                        <Smartphone className="w-4 h-4 mr-2" />
                                        Send iMessage/SMS
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                        <AutodataQRDialog
                            vehicleId={vehicle.id as number}
                            registration={vehicle.registration as string}
                            cachedMid={(vehicle as any).autodataMid}
                        />
                        <Link href={`/mot-check?reg=${vehicle.registration}`}>
                            <Button variant="outline" className="w-full bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100">
                                <ShieldCheck className="w-4 h-4 mr-2" />
                                MOT Check & Estimates
                            </Button>
                        </Link>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Vehicle Specifications */}
                    <Card className="md:col-span-2">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="w-5 h-5" />
                                Specifications & Status
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Make</p>
                                    <p className="text-sm font-bold">{vehicle.make as string || "Unknown"}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Model</p>
                                    <p className="text-sm font-bold">{vehicle.model as string || "Unknown"}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Fuel Type</p>
                                    <div className="flex items-center gap-2 text-sm font-bold uppercase">
                                        <Fuel className="w-4 h-4 text-orange-500" />
                                        {(vehicle.fuelType as string) || "-"}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Engine CC</p>
                                    <p className="text-sm font-bold">{vehicle.engineCC ? `${vehicle.engineCC}cc` : "-"}</p>
                                </div>
                                <div className={`space-y-1 rounded-lg border p-2 ${
                                    typeof motInfo !== "string" && motInfo.isExpired ? "bg-red-50 border-red-200" :
                                    typeof motInfo !== "string" && motInfo.daysUntilExpiry <= 30 ? "bg-orange-50 border-orange-200" :
                                    typeof motInfo !== "string" ? "bg-green-50 border-green-200" : "border-transparent"
                                }`}>
                                    <p className="text-xs font-medium text-muted-foreground uppercase">MOT Expiry</p>
                                    {typeof motInfo === "string" ? (
                                        <p className="text-sm font-bold text-muted-foreground">{motInfo}</p>
                                    ) : (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-lg font-extrabold">{motInfo.date}</p>
                                            <Badge variant={motBadge.variant} className={`text-[10px] px-2 py-0 ${motBadge.className || ""}`}>{motBadge.text}</Badge>
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Tax Status</p>
                                    <Badge variant={vehicle.taxStatus?.toLowerCase() === 'taxed' ? 'default' : 'destructive'} className="text-[10px] px-2 py-0">
                                        {vehicle.taxStatus as string || "Unknown"}
                                    </Badge>
                                </div>
                                <div className={`space-y-1 rounded-lg border p-2 ${
                                    vehicle.taxStatus?.toLowerCase() === 'taxed' ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                                }`}>
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Tax Due</p>
                                    <p className="text-lg font-extrabold">{formatDate(vehicle.taxDueDate)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Reg Date</p>
                                    <p className="text-sm font-bold">{formatDate(vehicle.dateOfRegistration)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">VIN</p>
                                    <div className="flex items-center gap-1 group">
                                        <p className="font-mono text-xs font-bold truncate max-w-[120px]" title={vehicle.vin || ""}>{vehicle.vin || "-"}</p>
                                        {vehicle.vin && (
                                            <>
                                                <button
                                                    onClick={() => {
                                                        if (vehicle.vin) {
                                                            navigator.clipboard.writeText(vehicle.vin);
                                                            toast.success("VIN copied to clipboard");
                                                        }
                                                    }}
                                                    className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Copy VIN"
                                                >
                                                    <Copy className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (vehicle.vin) {
                                                            navigator.clipboard.writeText(vehicle.vin);
                                                            toast.success("VIN copied and opening PartSouq...");
                                                            // Small delay to allow toast to render before opening tab
                                                            setTimeout(() => {
                                                                window.open(`https://partsouq.com/en/search/all?q=${vehicle.vin}`, "_blank");
                                                            }, 300);
                                                        }
                                                    }}
                                                    className="p-1 hover:bg-muted rounded text-blue-500 hover:text-blue-700 transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Search on PartSouq"
                                                >
                                                    <ExternalLink className="w-3 h-3" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Customer Info */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <User className="w-5 h-5" />
                                Customer
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {customer ? (
                                <div className="space-y-4">
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground uppercase">Name</p>
                                        <Link href={`${base}/customers/${customer.id}`}>
                                            <p className="text-sm font-bold uppercase hover:underline cursor-pointer text-primary">
                                                {customer.name as string}
                                            </p>
                                        </Link>
                                    </div>
                                    {!!customer.phone && (
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground uppercase">Phone</p>
                                            <p className="text-sm font-bold font-mono uppercase">{customer.phone as string}</p>
                                        </div>
                                    )}
                                    {!!customer.email && (
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground uppercase">Email</p>
                                            <p className="text-sm font-bold uppercase truncate">{customer.email as string}</p>
                                        </div>
                                    )}
                                    {(!!customer.address || !!customer.postcode) && (() => {
                                        const addr = String(customer.address || "").trim().replace(/,\s*$/, "");
                                        const pc = String(customer.postcode || "").trim();
                                        const hasPc = pc && addr.replace(/\s+/g, "").toUpperCase().endsWith(pc.replace(/\s+/g, "").toUpperCase());
                                        const full = [addr, hasPc ? "" : pc].filter(Boolean).join(", ");
                                        return (
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground uppercase">Address</p>
                                                <p className="text-sm font-medium uppercase">{full}</p>
                                            </div>
                                        );
                                    })()}
                                    <Link href={`${base}/customers/${customer.id}`}>
                                        <button className="text-xs text-primary font-medium hover:underline">View full customer record →</button>
                                    </Link>
                                    {!!customer.optedOut && (
                                        <Badge variant="destructive" className="w-full justify-center">
                                            <AlertCircle className="w-3 h-3 mr-2" />
                                            Opted Out
                                        </Badge>
                                    )}
                                    <div className="pt-2 border-t">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                                            disabled={unlinkOwner.isPending}
                                            onClick={() => {
                                                if (window.confirm(`Remove ${customer.name} as the owner of ${vehicle.registration}?\n\nThe vehicle and its full service history stay on the system — it just becomes unassigned. MOT reminders will stop going to this customer for this vehicle. You can reassign an owner later.`)) {
                                                    unlinkOwner.mutate({ vehicleId: vehicle.id as number });
                                                }
                                            }}
                                        >
                                            {unlinkOwner.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <User className="w-3.5 h-3.5 mr-1.5" />}
                                            {unlinkOwner.isPending ? "Removing…" : "Remove Owner"}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-6 text-muted-foreground italic text-sm">
                                    No customer assigned
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Rich Vehicle Intelligence */}
                    {!!vehicle.comprehensiveTechnicalData && (
                        <Card className="md:col-span-3 border-primary/20 bg-primary/5">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-primary">
                                    <Zap className="w-5 h-5 fill-primary" />
                                    Rich Vehicle Intelligence
                                </CardTitle>
                                <CardDescription>Data sourced from Premium UKVD and SWS Technical modules</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {/* UKVD Premium Render */}
                                {(() => {
                                    const ukvd = (vehicle.comprehensiveTechnicalData as any)?.ukvd;
                                    if (!ukvd) return null;
                                    return (
                                        <div className="mb-8 border rounded-xl overflow-hidden shadow-sm bg-white border-blue-100">
                                            <div className="bg-blue-50/50 p-4 border-b border-blue-100 flex items-center gap-2">
                                                <Sparkles className="w-5 h-5 text-blue-600" />
                                                <h3 className="font-bold text-blue-900">Premium Technical Data</h3>
                                            </div>
                                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                                {ukvd.imageUrl && (
                                                    <div className="rounded-lg overflow-hidden border-2 border-white shadow-sm flex items-center justify-center bg-white/50 bg-gray-50">
                                                        <img 
                                                            src={ukvd.imageUrl} 
                                                            alt={`${vehicle.make} ${vehicle.model}`} 
                                                            className="w-full h-auto max-h-[250px] object-contain"
                                                        />
                                                    </div>
                                                )}
                                                <div className="grid grid-cols-2 gap-4 place-content-start">
                                                    {ukvd.transmission?.type && (
                                                        <div>
                                                            <div className="text-xs text-slate-500 uppercase tracking-wide">Transmission</div>
                                                            <div className="font-medium capitalize text-sm">{ukvd.transmission.type.toLowerCase()} {ukvd.transmission.gears ? `(${ukvd.transmission.gears} Speed)` : ''}</div>
                                                        </div>
                                                    )}
                                                    {ukvd.transmission?.driveType && (
                                                        <div>
                                                            <div className="text-xs text-slate-500 uppercase tracking-wide">Drivetrain</div>
                                                            <div className="font-medium text-sm">{ukvd.transmission.driveType}</div>
                                                        </div>
                                                    )}
                                                    {ukvd.fuelTankCapacity && (
                                                        <div>
                                                            <div className="text-xs text-slate-500 uppercase tracking-wide">Fuel Tank</div>
                                                            <div className="font-medium text-sm">{ukvd.fuelTankCapacity} Litres</div>
                                                        </div>
                                                    )}
                                                    {ukvd.dimensions?.length && (
                                                        <div>
                                                            <div className="text-xs text-slate-500 uppercase tracking-wide">Length</div>
                                                            <div className="font-medium text-sm">{ukvd.dimensions.length} mm</div>
                                                        </div>
                                                    )}
                                                    {ukvd.dimensions?.width && (
                                                        <div>
                                                            <div className="text-xs text-slate-500 uppercase tracking-wide">Width</div>
                                                            <div className="font-medium text-sm">{ukvd.dimensions.width} mm</div>
                                                        </div>
                                                    )}
                                                    {ukvd.weights?.kerb && (
                                                        <div>
                                                            <div className="text-xs text-slate-500 uppercase tracking-wide">Kerb Weight</div>
                                                            <div className="font-medium text-sm">{ukvd.weights.kerb} kg</div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Provenance Block */}
                                            {ukvd.provenance && (
                                                <div className="border-t border-blue-100 bg-slate-50 p-6">
                                                  <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
                                                    <ShieldCheck className="w-5 h-5 text-slate-600" />
                                                    Provenance & Security Details
                                                  </h4>
                                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                                    {/* Police / Stolen */}
                                                    <div className={`p-4 rounded-lg border \${ukvd.provenance.isStolen ? 'bg-red-50 border-red-200 text-red-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
                                                      <div className="flex items-center gap-3">
                                                        {ukvd.provenance.isStolen ? <ShieldAlert className="w-8 h-8 text-red-600" /> : <ShieldCheck className="w-8 h-8 text-green-600" />}
                                                        <div>
                                                          <div className="font-bold">Police Check</div>
                                                          <div className="text-sm opacity-90">{ukvd.provenance.isStolen ? 'STOLEN RECORD' : 'Clear'}</div>
                                                        </div>
                                                      </div>
                                                    </div>

                                                    {/* MIAFTR / Write Offs */}
                                                    <div className={`p-4 rounded-lg border \${ukvd.provenance.hasWriteOff ? 'bg-red-50 border-red-200 text-red-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
                                                      <div className="flex items-center gap-3">
                                                        {ukvd.provenance.hasWriteOff ? <AlertTriangle className="w-8 h-8 text-red-600" /> : <CheckCircle2 className="w-8 h-8 text-green-600" />}
                                                        <div>
                                                          <div className="font-bold">Insurance (MIAFTR)</div>
                                                          <div className="text-sm opacity-90">{ukvd.provenance.hasWriteOff ? 'WRITE-OFF RECORDED' : 'Clear'}</div>
                                                        </div>
                                                      </div>
                                                    </div>

                                                    {/* Outstanding Finance */}
                                                    <div className={`p-4 rounded-lg border \${ukvd.provenance.hasFinance ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
                                                      <div className="flex items-center gap-3">
                                                        {ukvd.provenance.hasFinance ? <Banknote className="w-8 h-8 text-amber-600" /> : <CheckCircle2 className="w-8 h-8 text-green-600" />}
                                                        <div>
                                                          <div className="font-bold">Finance</div>
                                                          <div className="text-sm opacity-90">{ukvd.provenance.hasFinance ? 'OUTSTANDING FINANCE' : 'Clear'}</div>
                                                        </div>
                                                      </div>
                                                    </div>

                                                    {/* Mileage Anomaly */}
                                                    <div className={`p-4 rounded-lg border \${ukvd.provenance.mileageAnomaly ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
                                                      <div className="flex items-center gap-3">
                                                        {ukvd.provenance.mileageAnomaly ? <Gauge className="w-8 h-8 text-amber-600" /> : <CheckCircle2 className="w-8 h-8 text-green-600" />}
                                                        <div>
                                                          <div className="font-bold">Mileage</div>
                                                          <div className="text-sm opacity-90">{ukvd.provenance.mileageAnomaly ? 'ANOMALY DETECTED' : 'Verified Sequence'}</div>
                                                        </div>
                                                      </div>
                                                    </div>

                                                    {/* Registration Status Flags */}
                                                    {(ukvd.provenance.scrapped || ukvd.provenance.exported || ukvd.provenance.imported) && (
                                                      <div className="col-span-full mt-2 flex flex-wrap gap-2">
                                                        {ukvd.provenance.scrapped && <Badge variant="destructive" className="text-sm tracking-wide">SCRAPPED MARKER</Badge>}
                                                        {ukvd.provenance.exported && <Badge variant="secondary" className="bg-slate-200 text-slate-800 text-sm tracking-wide">EXPORTED</Badge>}
                                                        {ukvd.provenance.imported && <Badge variant="secondary" className="bg-slate-200 text-slate-800 text-sm tracking-wide">IMPORTED</Badge>}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                            )}

                                        </div>
                                    );
                                })()}

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {/* Lubricants Section */}
                                    {(vehicle.comprehensiveTechnicalData as any).lubricants && (
                                        <div className="space-y-4">
                                            <h3 className="font-bold flex items-center gap-2 border-b pb-2">
                                                <Droplet className="w-4 h-4 text-blue-500" />
                                                Lubricants & Fluids
                                            </h3>
                                            <LubricantsSummary lubricants={(vehicle.comprehensiveTechnicalData as any).lubricants} />
                                        </div>
                                    )}

                                    {/* Aircon Section */}
                                    {(vehicle.comprehensiveTechnicalData as any).aircon && (
                                        <div className="space-y-4">
                                            <h3 className="font-bold flex items-center gap-2 border-b pb-2">
                                                <Thermometer className="w-4 h-4 text-cyan-500" />
                                                Air Conditioning
                                            </h3>
                                            <div className="space-y-3">
                                                <div className="text-sm">
                                                    <p className="text-xs font-medium text-muted-foreground uppercase">Refrigerant Type</p>
                                                    <p className="font-bold">{((vehicle.comprehensiveTechnicalData as any).aircon.type as string) || 'N/A'}</p>
                                                </div>
                                                <div className="text-sm">
                                                    <p className="text-xs font-medium text-muted-foreground uppercase">Gas Quantity</p>
                                                    <p className="font-bold">{((vehicle.comprehensiveTechnicalData as any).aircon.quantity as string) || 'N/A'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Specs / Generic */}
                                    <div className="space-y-4">
                                        <h3 className="font-bold flex items-center gap-2 border-b pb-2">
                                            <Wrench className="w-4 h-4 text-orange-500" />
                                            Technical Specs
                                        </h3>
                                        <div className="space-y-3">
                                            <div className="text-sm">
                                                <p className="text-xs font-medium text-muted-foreground uppercase">Engine Code</p>
                                                <p className="font-bold">{(vehicle.engineCode as string) || "-"}</p>
                                            </div>
                                            <div className="text-sm">
                                                <p className="text-xs font-medium text-muted-foreground uppercase">Last Deep Scan</p>
                                                <p className="text-xs font-bold">{vehicle.swsLastUpdated ? new Date(vehicle.swsLastUpdated).toLocaleString() : "Never"}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Service History */}
                    <Card className="md:col-span-3">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="w-5 h-5" />
                                Workshop Service History
                            </CardTitle>
                            <CardDescription>Service timeline, every part fitted &amp; full MOT history</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <VehicleHistoryTabs vehicleId={vehicle.id} registration={vehicle.registration} />
                        </CardContent>
                    </Card>

                    {/* Reminder History */}
                    <Card className="md:col-span-3">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Calendar className="w-5 h-5" />
                                communication History
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {reminders.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Due Date</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Sent At</TableHead>
                                            <TableHead>Method</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {reminders.map((reminder) => (
                                            <TableRow key={reminder.id}>
                                                <TableCell>
                                                    <Badge variant={reminder.type === 'MOT' ? 'default' : 'secondary'}>
                                                        {reminder.type}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{formatDate(reminder.dueDate)}</TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={
                                                            reminder.status === 'sent' ? 'outline' :
                                                                reminder.status === 'archived' ? 'secondary' : 'default'
                                                        }
                                                        className={reminder.status === 'sent' ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}
                                                    >
                                                        {reminder.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{formatDate(reminder.sentAt)}</TableCell>
                                                <TableCell className="capitalize">{reminder.sentMethod || "-"}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <div className="text-center py-12 text-muted-foreground">
                                    <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                    <p>No communication history found</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
