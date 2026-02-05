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
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>No.</TableHead>
                        <TableHead>Mileage</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {history.map((doc) => (
                        <TableRow key={doc.id}>
                            <TableCell>
                                {doc.dateCreated ? format(new Date(doc.dateCreated), "dd/MM/yyyy") : "-"}
                            </TableCell>
                            <TableCell>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${doc.docType === 'SI' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                                    }`}>
                                    {doc.docType === 'SI' ? 'Invoice' : 'Estimate'}
                                </span>
                            </TableCell>
                            <TableCell>{doc.docNo || doc.externalId.substring(0, 8)}</TableCell>
                            <TableCell>{doc.mileage ? doc.mileage.toLocaleString() : "-"}</TableCell>
                            <TableCell className="text-right font-medium">
                                £{Number(doc.totalGross).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedDoc(doc.id)}
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
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
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
                    {items?.map((item) => (
                        <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.description}</TableCell>
                            <TableCell className="text-right">{Number(item.quantity).toFixed(2)}</TableCell>
                            <TableCell className="text-right">£{Number(item.unitPrice).toFixed(2)}</TableCell>
                            <TableCell className="text-right">£{Number(item.subNet).toFixed(2)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <div className="space-y-2 text-right pt-4 border-t">
                <div className="flex justify-end gap-12 text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium w-24">£{Number(doc?.totalNet).toFixed(2)}</span>
                </div>
                <div className="flex justify-end gap-12 text-sm">
                    <span className="text-muted-foreground">VAT</span>
                    <span className="font-medium w-24">£{Number(doc?.totalTax).toFixed(2)}</span>
                </div>
                <div className="flex justify-end gap-12 text-lg font-bold">
                    <span>Total</span>
                    <span className="w-24 border-t-2 border-double pt-1">
                        £{Number(doc?.totalGross).toFixed(2)}
                    </span>
                </div>
            </div>
        </div>
    );
}
