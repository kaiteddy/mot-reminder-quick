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
    DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import { useState } from "react";

interface ServiceHistoryProps {
    vehicleId: number;
}

export function ServiceHistory({ vehicleId }: ServiceHistoryProps) {
    const { data: history, isLoading } = trpc.serviceHistory.getByVehicleId.useQuery({ vehicleId });
    const [selectedDoc, setSelectedDoc] = useState<number | null>(null);

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
        <div className="space-y-4">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[100px]">Date</TableHead>
                        <TableHead className="w-[80px]">Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-[120px]">No.</TableHead>
                        <TableHead className="w-[100px]">Mileage</TableHead>
                        <TableHead className="text-right w-[100px]">Total</TableHead>
                        <TableHead className="text-right w-[80px]">Action</TableHead>
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
                            <TableCell className="min-w-[200px] max-w-[500px]">
                                <div className="break-words">
                                    {doc.mainDescription || "No details available"}
                                </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs font-mono">{doc.docNo || doc.externalId.substring(0, 8)}</TableCell>
                            <TableCell>{doc.mileage ? doc.mileage.toLocaleString() : "-"}</TableCell>
                            <TableCell className="text-right font-medium">
                                £{Number(doc.totalGross).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
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
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <Dialog open={selectedDoc !== null} onOpenChange={(open) => !open && setSelectedDoc(null)}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Document Details</DialogTitle>
                    </DialogHeader>
                    {selectedDoc && <LineItemsView documentId={selectedDoc} history={history} />}
                </DialogContent>
            </Dialog>
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
                        {doc.description}
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
                                        <TableCell className="font-medium text-slate-700">{item.description}</TableCell>
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
                                        <TableCell className="font-medium text-slate-700">{item.description}</TableCell>
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
                                    <td className="p-2 font-medium">{item.description}</td>
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
