import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Edit, FileText, Loader2, Printer, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";
import { useLocation } from "wouter";

const cleanText = (text: string | null) => {
    if (!text) return "";
    // Remove non-printable characters and normalize line breaks
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
        .trim();
};

const FormattedDescription = ({ text }: { text: string | null }) => {
    if (!text) return null;

    // Split by common list separators and clean up
    const points = text
        .split(/[\n\r]|(?:\s+-\s+)|(?:\s+–\s+)|(?:\s+—\s+)/)
        .map(p => p.trim())
        .filter(p => p.length > 3); // Filter out very short segments that might be noise

    if (points.length <= 1) {
        return <div className="text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap font-medium">{text}</div>;
    }

    return (
        <ul className="list-none space-y-2 p-0 m-0">
            {points.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-700 font-medium">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                    <span className="flex-1">{point}</span>
                </li>
            ))}
        </ul>
    );
};

interface ServiceHistoryProps {
    vehicleId: number;
}

export function ServiceHistory({ vehicleId }: ServiceHistoryProps) {
    const [, setLocation] = useLocation();
    const { data: history, isLoading } = trpc.serviceHistory.getDetailedByVehicleId.useQuery({ vehicleId });
    const [selectedDoc, setSelectedDoc] = useState<number | null>(null);
    const printRef = useRef<HTMLDivElement>(null);
    const utils = trpc.useContext();
    const deleteMutation = trpc.serviceHistory.delete.useMutation({
        onSuccess: () => {
            utils.serviceHistory.getDetailedByVehicleId.invalidate({ vehicleId });
            toast.success("Document deleted successfully");
            setSelectedDoc(null);
        },
        onError: (err) => {
            toast.error(`Failed to delete document: ${err.message}`);
        }
    });

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Vehicle_History_${vehicleId}`,
    });

    const handleDelete = (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm("Are you sure you want to delete this document? This action cannot be undone.")) {
            deleteMutation.mutate({ id });
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!history || history.length === 0) {
        return (
            <div className="text-center p-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground">No service history found for this vehicle.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4 pt-2">
            <div className="flex justify-end mb-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePrint()}
                    className="border-primary/20 hover:bg-primary/5 text-primary font-bold shadow-sm transition-all"
                >
                    <Download className="w-4 h-4 mr-2" />
                    Export Full History (PDF)
                </Button>
            </div>
            <Table className="w-full">
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[100px] whitespace-nowrap">Date</TableHead>
                        <TableHead className="w-[80px] whitespace-nowrap">Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-[120px] whitespace-nowrap">No.</TableHead>
                        <TableHead className="w-[100px] whitespace-nowrap">Mileage</TableHead>
                        <TableHead className="text-right w-[100px] whitespace-nowrap">Total</TableHead>
                        <TableHead className="text-right w-[80px] whitespace-nowrap">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {history.map((doc: any) => (
                        <TableRow
                            key={doc.id}
                            className="cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => setSelectedDoc(doc.id)}
                        >
                            <TableCell>
                                {doc.dateCreated ? format(new Date(doc.dateCreated), "dd/MM/yyyy") : "-"}
                            </TableCell>
                            <TableCell>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${doc.docType === 'SI' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                                    }`}>
                                    {doc.docType === 'SI' ? 'Invoice' : 'Estimate'}
                                </span>
                            </TableCell>
                            <TableCell className="min-w-[200px] max-w-[500px] whitespace-normal">
                                <div className="break-words">
                                    {cleanText(doc.mainDescription) || "No details available"}
                                </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs font-mono">{doc.docNo || doc.externalId.substring(0, 8)}</TableCell>
                            <TableCell>{doc.mileage ? doc.mileage.toLocaleString() : "-"}</TableCell>
                            <TableCell className="text-right font-medium">
                                £{Number(doc.totalGross).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setLocation(`/generate-document?editId=${doc.id}`);
                                        }}
                                    >
                                        <Edit className="h-4 w-4 mr-2" />
                                        Edit
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedDoc(doc.id);
                                        }}
                                    >
                                        <FileText className="h-4 w-4 mr-2" />
                                        View
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                                        onClick={(e) => handleDelete(doc.id, e)}
                                        disabled={deleteMutation.isPending && deleteMutation.variables?.id === doc.id}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <Dialog open={selectedDoc !== null} onOpenChange={(open) => !open && setSelectedDoc(null)}>
                <DialogContent className="max-w-4xl sm:max-w-[85vw] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Document Details</DialogTitle>
                        <DialogDescription className="sr-only">
                            Detailed view of the selected workshop document and its line items.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedDoc && (
                        <div className="space-y-4">
                            <LineItemsView documentId={selectedDoc} history={history} />
                            <div className="flex justify-end pt-4 border-t gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setLocation(`/generate-document?editId=${selectedDoc}`)}
                                >
                                    <Edit className="h-4 w-4 mr-2" />
                                    Edit Document
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={(e) => handleDelete(selectedDoc, e as any)}
                                    disabled={deleteMutation.isPending}
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Document
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Hidden Printable History */}
            <div style={{ display: "none" }}>
                <div ref={printRef} className="p-10 text-slate-900 bg-white min-h-screen font-sans print:p-8">
                    <style dangerouslySetInnerHTML={{
                        __html: `
                        @media print {
                            @page { size: A4; margin: 20mm; }
                            .service-record { break-inside: avoid; page-break-inside: avoid; }
                        }
                    `}} />
                    <div className="flex justify-between items-end border-b-2 border-slate-900 pb-4 mb-8">
                        <div>
                            <h1 className="text-3xl font-black uppercase tracking-tighter mb-0.5">Vehicle Service History</h1>
                            <p className="text-slate-500 font-bold uppercase text-[10px] tracking-[0.2em] leading-none">Eli Motors Ltd • Complete Maintenance Record</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xl font-black font-mono leading-none">ELI MOTORS LTD</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Professional Services</p>
                        </div>
                    </div>

                    <div className="space-y-12">
                        {history.map((doc: any) => (
                            <div key={doc.id} className="service-record relative pl-8 border-l-2 border-slate-100 pb-2 last:pb-0">
                                <div className="absolute -left-[7px] top-0 w-3 h-3 rounded-full border-2 border-white bg-slate-900 shadow-sm" />

                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className="text-sm font-black text-slate-900">
                                                {doc.dateCreated ? format(new Date(doc.dateCreated), "dd MMMM yyyy") : "-"}
                                            </span>
                                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${doc.docType === 'SI' ? 'bg-blue-600 text-white' : 'bg-slate-500 text-white'
                                                }`}>
                                                {doc.docType === 'SI' ? 'Invoice' : 'Estimate'}
                                            </span>
                                            <span className="text-[11px] font-mono text-slate-400">#{doc.docNo || doc.externalId.substring(0, 8)}</span>
                                        </div>
                                        {doc.mileage && (
                                            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-tight">Mileage: {doc.mileage.toLocaleString()} mi</p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-slate-900">Total: £{Number(doc.totalGross).toFixed(2)}</p>
                                        <p className="text-[9px] text-slate-400 font-bold uppercase">Recorded Entry</p>
                                    </div>
                                </div>

                                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/80 mb-4">
                                    <p className="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest">Job Description</p>
                                    <FormattedDescription text={doc.description || doc.mainDescription} />
                                </div>

                                {doc.items && doc.items.length > 0 && (
                                    <div className="ml-2 space-y-4">
                                        {doc.items.filter((i: any) => i.itemType === 'Labour').length > 0 && (
                                            <div>
                                                <h4 className="text-[9px] font-black uppercase text-blue-600 mb-1.5 tracking-wider flex items-center gap-2">
                                                    Labour
                                                    <div className="h-[1px] flex-1 bg-blue-100"></div>
                                                </h4>
                                                <div className="grid grid-cols-1 gap-1">
                                                    {doc.items.filter((i: any) => i.itemType === 'Labour').map((item: any) => (
                                                        <div key={item.id} className="flex justify-between text-[11px] py-1 border-b border-slate-50 last:border-0">
                                                            <span className="text-slate-600 flex-1 pr-4">{item.description}</span>
                                                            <span className="font-bold text-slate-900">£{Number(item.subNet).toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {doc.items.filter((i: any) => i.itemType === 'Part').length > 0 && (
                                            <div>
                                                <h4 className="text-[9px] font-black uppercase text-orange-600 mb-1.5 tracking-wider flex items-center gap-2">
                                                    Parts & Consumables
                                                    <div className="h-[1px] flex-1 bg-orange-100"></div>
                                                </h4>
                                                <div className="grid grid-cols-1 gap-1">
                                                    {doc.items.filter((i: any) => i.itemType === 'Part').map((item: any) => (
                                                        <div key={item.id} className="flex justify-between text-[11px] py-1 border-b border-slate-50 last:border-0">
                                                            <span className="text-slate-600 flex-1 pr-4">{item.description}</span>
                                                            <div className="text-right">
                                                                <span className="text-[9px] text-slate-400 mr-3">{item.quantity} x £{Number(item.unitPrice).toFixed(2)}</span>
                                                                <span className="font-bold text-slate-900">£{Number(item.subNet).toFixed(2)}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="mt-12 pt-6 border-t border-slate-100 text-center">
                        <div className="flex justify-center gap-8 mb-4">
                            <div className="text-center">
                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total Records</p>
                                <p className="text-lg font-black text-slate-900">{history.length}</p>
                            </div>
                            <div className="text-center">
                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">Cumulative Spend</p>
                                <p className="text-lg font-black text-slate-900 text-blue-600">
                                    £{history.reduce((sum: number, doc: any) => sum + Number(doc.totalGross), 0).toFixed(2)}
                                </p>
                            </div>
                        </div>
                        <p className="text-[9px] text-slate-300 font-medium italic">
                            Generated by Eli Motors Management Suite on {format(new Date(), "PPpp")}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function LineItemsView({ documentId, history }: { documentId: number, history: any[] }) {
    const { data: items, isLoading } = trpc.serviceHistory.getLineItems.useQuery({ documentId });
    const doc = history.find(h => h.id === documentId);

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 text-sm border-b pb-4">
                <div>
                    <p className="text-muted-foreground">Document Number</p>
                    <p className="font-semibold">{doc?.docNo || doc?.externalId}</p>
                </div>
                <div className="text-right">
                    <p className="text-muted-foreground">Date</p>
                    <p className="font-semibold">
                        {doc?.dateCreated ? format(new Date(doc.dateCreated), "PPPP") : "-"}
                    </p>
                </div>
            </div>

            {doc?.description && (
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                    <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Job Description</h4>
                    <FormattedDescription text={doc.description} />
                </div>
            )}

            <div className="space-y-4">
                {items?.filter(i => i.itemType === 'Labour').length ? (
                    <div>
                        <h4 className="text-xs font-bold uppercase text-blue-600 mb-2">Labour</h4>
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead>Description</TableHead>
                                    <TableHead className="text-right w-20">Qty</TableHead>
                                    <TableHead className="text-right w-24">Price</TableHead>
                                    <TableHead className="text-right w-24">Subtotal</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.filter(i => i.itemType === 'Labour').map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium text-slate-700 whitespace-normal">{item.description}</TableCell>
                                        <TableCell className="text-right">{Number(item.quantity).toFixed(2)}</TableCell>
                                        <TableCell className="text-right">£{Number(item.unitPrice).toFixed(2)}</TableCell>
                                        <TableCell className="text-right font-semibold">£{Number(item.subNet).toFixed(2)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : null}

                {items?.filter(i => i.itemType === 'Part').length ? (
                    <div>
                        <h4 className="text-xs font-bold uppercase text-orange-600 mb-2">Parts</h4>
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead>Description</TableHead>
                                    <TableHead className="text-right w-20">Qty</TableHead>
                                    <TableHead className="text-right w-24">Price</TableHead>
                                    <TableHead className="text-right w-24">Subtotal</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.filter(i => i.itemType === 'Part').map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium text-slate-700 whitespace-normal">{item.description}</TableCell>
                                        <TableCell className="text-right">{Number(item.quantity).toFixed(2)}</TableCell>
                                        <TableCell className="text-right">£{Number(item.unitPrice).toFixed(2)}</TableCell>
                                        <TableCell className="text-right font-semibold">£{Number(item.subNet).toFixed(2)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : null}

                {items?.filter(i => i.itemType !== 'Labour' && i.itemType !== 'Part').length ? (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Price</TableHead>
                                <TableHead className="text-right">Subtotal</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.filter(i => i.itemType !== 'Labour' && i.itemType !== 'Part').map((item) => (
                                <tr key={item.id} className="border-b">
                                    <td className="p-2 font-medium whitespace-normal">{item.description}</td>
                                    <td className="p-2 text-right">{Number(item.quantity).toFixed(2)}</td>
                                    <td className="p-2 text-right">£{Number(item.unitPrice).toFixed(2)}</td>
                                    <td className="p-2 text-right">£{Number(item.subNet).toFixed(2)}</td>
                                </tr>
                            ))}
                        </TableBody>
                    </Table>
                ) : null}
            </div>

            <div className="space-y-2 text-right pt-4 border-t">
                {items && items.length > 0 && (
                    <>
                        <div className="flex justify-end gap-12 text-sm">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span className="font-medium w-24">£{Number(doc?.totalNet || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-end gap-12 text-sm">
                            <span className="text-muted-foreground">VAT</span>
                            <span className="font-medium w-24">£{Number(doc?.totalTax || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-end gap-12 text-lg font-bold">
                            <span>Total</span>
                            <span className="w-24 border-t-2 border-double pt-1">
                                £{(Number(doc?.totalGross) > 0 ? Number(doc.totalGross) : items.reduce((sum, i) => sum + Number(i.subNet), 0)).toFixed(2)}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
