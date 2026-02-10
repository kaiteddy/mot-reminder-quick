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

interface ServiceHistoryProps {
    vehicleId: number;
}

export function ServiceHistory({ vehicleId }: ServiceHistoryProps) {
    const [, setLocation] = useLocation();
    const { data: history, isLoading } = trpc.serviceHistory.getByVehicleId.useQuery({ vehicleId });
    const [selectedDoc, setSelectedDoc] = useState<number | null>(null);
    const printRef = useRef<HTMLDivElement>(null);
    const utils = trpc.useContext();
    const deleteMutation = trpc.serviceHistory.delete.useMutation({
        onSuccess: () => {
            utils.serviceHistory.getByVehicleId.invalidate({ vehicleId });
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
                    {history.map((doc) => (
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
                <div ref={printRef} className="p-10 text-slate-900 bg-white min-h-screen font-sans">
                    <div className="flex justify-between items-end border-b-2 border-slate-900 pb-4 mb-6">
                        <div>
                            <h1 className="text-2xl font-black uppercase tracking-tighter mb-0.5">Vehicle Service History</h1>
                            <p className="text-slate-500 font-bold uppercase text-[9px] tracking-widest leading-none">Complete Maintenance Record Timeline</p>
                        </div>
                        <div className="text-right">
                            <p className="text-lg font-black font-mono leading-none">ELI MOTORS LTD</p>
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Professional Automotive Services</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {history.map((doc, idx) => (
                            <div key={doc.id} className="relative pl-6 border-l border-slate-200 pb-4 last:pb-0">
                                <div className="absolute -left-[4.5px] top-1 w-2 h-2 rounded-full bg-slate-900" />
                                <div className="flex justify-between items-center mb-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-black text-white bg-slate-900 px-1.5 py-0.5 rounded">
                                            {doc.dateCreated ? format(new Date(doc.dateCreated), "dd/MM/yyyy") : "-"}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                                            {doc.docType === 'SI' ? 'Invoice' : 'Estimate'} #{doc.docNo || doc.externalId.substring(0, 8)}
                                        </span>
                                    </div>
                                    <div className="text-right flex items-center gap-4">
                                        <div className="text-right">
                                            <p className="text-[9px] text-slate-400 font-bold uppercase leading-none">{doc.mileage ? `${doc.mileage.toLocaleString()} mi` : "No Mileage"}</p>
                                            <p className="text-sm font-black tracking-tight leading-none text-slate-900">£{Number(doc.totalGross).toFixed(2)}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-slate-50 px-4 py-2.5 rounded-lg border border-slate-100">
                                    <div className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap font-medium">
                                        {cleanText(doc.description || doc.mainDescription)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-8 pt-4 border-t border-dashed border-slate-200 text-center">
                        <p className="text-[8px] text-slate-400 font-medium italic">
                            Official service record generated by Eli Motors Ltd on {format(new Date(), "PPpp")}
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
                    <pre className="text-sm font-sans whitespace-pre-wrap text-slate-700 leading-relaxed">
                        {cleanText(doc.description)}
                    </pre>
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
