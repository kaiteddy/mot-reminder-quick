import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Loader2, Calculator, Edit2, FileText, CheckCircle2, Printer, CheckSquare, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";

interface MOTEstimateCreatorProps {
  vehicleDetails: {
    make?: string;
    model?: string;
    year?: number;
    registration?: string;
  };
  defects: Array<{
    text: string;
    type: string;
    dangerous?: boolean;
  }>;
}

export function MOTEstimateCreator({ vehicleDetails, defects }: MOTEstimateCreatorProps) {
  const [estimate, setEstimate] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedRepairs, setSelectedRepairs] = useState<boolean[]>([]);
  const componentRef = useRef<HTMLDivElement>(null);
  const [preSelectedDefects, setPreSelectedDefects] = useState<boolean[]>([]);

  useEffect(() => {
    setPreSelectedDefects(new Array(defects.length).fill(true));
  }, [defects]);

  const togglePreSelection = (index: number) => {
    const newSelected = [...preSelectedDefects];
    newSelected[index] = !newSelected[index];
    setPreSelectedDefects(newSelected);
  };

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `MOT_Estimate_${vehicleDetails.make || "Garage"}_${vehicleDetails.registration || ""}`,
  });

  const generateMutation = trpc.ai.generateMOTEstimate.useMutation({
    onSuccess: (data) => {
      setEstimate(data);
      setSelectedRepairs(new Array(data.repairs.length).fill(true));
    },
  });

  const handleGenerate = () => {
    const selectedDefectsToEstimate = defects.filter((_, idx) => preSelectedDefects[idx]);
    if (selectedDefectsToEstimate.length === 0) {
      toast.error("Please select at least one defect to estimate.");
      return;
    }
    
    generateMutation.mutate({
      make: vehicleDetails.make,
      model: vehicleDetails.model,
      year: vehicleDetails.year,
      defects: selectedDefectsToEstimate,
    });
  };

  const updateCost = (index: number, field: 'partsCost' | 'labourCost', value: string) => {
    if (!estimate) return;
    const numValue = parseFloat(value) || 0;
    const updatedRepairs = [...estimate.repairs];
    updatedRepairs[index][field] = numValue;
    updatedRepairs[index].estimatedTotal = updatedRepairs[index].partsCost + updatedRepairs[index].labourCost;
    
    setEstimate({
      ...estimate,
      repairs: updatedRepairs,
      summary: {
        ...estimate.summary,
        minimumToPass: calculateNewTotal(updatedRepairs, selectedRepairs, true),
        withAdvisories: calculateNewTotal(updatedRepairs, selectedRepairs, false),
      }
    });
  };

  const toggleRepairSelection = (index: number) => {
    if (!estimate) return;
    const newSelected = [...selectedRepairs];
    newSelected[index] = !newSelected[index];
    setSelectedRepairs(newSelected);
    
    setEstimate({
      ...estimate,
      summary: {
        ...estimate.summary,
        minimumToPass: calculateNewTotal(estimate.repairs, newSelected, true),
        withAdvisories: calculateNewTotal(estimate.repairs, newSelected, false),
      }
    });
  };

  const calculateNewTotal = (repairs: any[], selected: boolean[], onlyRequired: boolean) => {
    const total = repairs
      .filter((r, idx) => selected[idx] && (onlyRequired ? ['DANGEROUS', 'MAJOR'].includes(r.classification) : true))
      .reduce((sum, r) => sum + r.estimatedTotal, 0);
    return `£${total.toFixed(2)}`;
  };

  if (!estimate && !generateMutation.isPending) {
    return (
      <Card className="mt-4 border-dashed bg-slate-50">
        <CardContent className="flex flex-col items-center justify-center p-6 space-y-4">
          <div className="text-center mt-2">
            <h3 className="font-semibold text-slate-700 text-lg">Select items to include in the estimate</h3>
            <p className="text-sm text-slate-500 max-w-md mt-1 mb-4">
              Choose which MOT failures and advisories you want the AI to calculate pricing for.
            </p>
          </div>
          
          <div className="w-full max-w-2xl text-left border rounded-lg overflow-hidden bg-white shadow-sm mb-2 max-h-[300px] overflow-y-auto">
            {defects.map((defect, idx) => (
               <div key={idx} className={`flex items-start gap-3 p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors ${!preSelectedDefects[idx] ? 'opacity-60 bg-slate-50/50 grayscale' : ''}`} onClick={() => togglePreSelection(idx)}>
                 <button className="text-slate-400 mt-1" tabIndex={-1}>
                    {preSelectedDefects[idx] ? <CheckSquare className="w-5 h-5 text-primary" /> : <Square className="w-5 h-5" />}
                 </button>
                 <div>
                    <Badge variant={defect.type === "FAIL" ? "destructive" : "secondary"} className="mb-1 text-[10px] leading-tight px-1.5 py-0 uppercase shadow-none font-bold">
                      {defect.dangerous ? "DANGEROUS" : defect.type}
                    </Badge>
                    <p className={`text-sm font-medium leading-snug ${preSelectedDefects[idx] ? 'text-slate-800' : 'text-slate-500'}`}>{defect.text}</p>
                 </div>
               </div>
            ))}
          </div>

          <Button onClick={handleGenerate} className="gap-2 mt-2 w-full max-w-sm" disabled={!preSelectedDefects.some(Boolean) || defects.length === 0}>
            <Calculator className="w-4 h-4 mr-1" />
            Generate Repair Estimate
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (generateMutation.isPending) {
    return (
      <Card className="mt-4 border-dashed bg-blue-50/50">
        <CardContent className="flex flex-col items-center justify-center p-12 space-y-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-blue-700 font-medium">Analyzing defects & calculating UK garage estimates...</p>
        </CardContent>
      </Card>
    );
  }

  if (!estimate) return null;

  return (
    <div ref={componentRef} className="mt-6">
      <Card className="border-blue-200 shadow-sm print:shadow-none print:border-none print:mb-8">
      <CardHeader className="bg-blue-50/50 border-b border-blue-100 pb-4 print:bg-transparent print:border-b-2 print:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-blue-900">
              <FileText className="w-5 h-5" />
              MOT Repair Estimate
            </CardTitle>
            <CardDescription className="text-blue-700/70 mt-1">
              Estimated costs for parts and labour. You can edit the numbers to match your actual garage pricing.
            </CardDescription>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => handlePrint()} className="gap-2 bg-white text-slate-700 hover:text-slate-900">
              <Printer className="w-4 h-4" />
              Print Worksheet
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsEditing(!isEditing)} className="gap-2 bg-white">
              {isEditing ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Edit2 className="w-4 h-4" />}
              {isEditing ? "Save Adjustments" : "Edit Pricing"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 print:p-4">
        <div className="overflow-x-auto print:overflow-visible">
          <Table className="print:border-collapse print:border-spacing-0">
            <TableHeader className="bg-slate-50/50 print:bg-slate-100">
              <TableRow className="print:border-none">
                <TableHead className="w-[40px] print:hidden"></TableHead>
                <TableHead className="w-[120px] print:w-[100px] print:text-black">Classification</TableHead>
                <TableHead className="print:text-black">Repair Item</TableHead>
                <TableHead className="w-[100px] text-right print:w-[80px] print:text-black">Parts</TableHead>
                <TableHead className="w-[100px] text-right print:w-[80px] print:text-black">Labour</TableHead>
                <TableHead className="w-[120px] text-right print:w-[90px] print:text-black">Est Total</TableHead>
                {/* Print-only empty columns for mechanic to write on */}
                <TableHead className="hidden print:table-cell w-[160px] border border-slate-300 font-bold text-black py-2 pl-2">Part No / Supplier</TableHead>
                <TableHead className="hidden print:table-cell w-[100px] text-right border border-slate-300 font-bold text-black py-2 pr-2">Actual £</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimate.repairs.map((repair: any, index: number) => {
                const isRequired = ["DANGEROUS", "MAJOR"].includes(repair.classification);
                const isSelected = selectedRepairs[index];
                return (
                  <TableRow key={index} className={`${isRequired ? "bg-red-50/20" : ""} print:bg-white print:border-b print:border-slate-200 ${!isSelected ? "opacity-40 grayscale" : ""}`}>
                    <TableCell className="print:hidden">
                      <button 
                        onClick={() => toggleRepairSelection(index)}
                        className="text-slate-400 hover:text-primary transition-colors flex items-center justify-center p-1"
                        title={isSelected ? "Exclude from total" : "Include in total"}
                      >
                        {isSelected ? <CheckSquare className="w-5 h-5 text-primary" /> : <Square className="w-5 h-5" />}
                      </button>
                    </TableCell>
                    <TableCell className="print:py-3 cursor-default">
                      <Badge variant={
                        repair.classification === "DANGEROUS" ? "destructive" :
                        repair.classification === "MAJOR" ? "destructive" :
                        "secondary"
                      } className={`print:bg-transparent print:text-slate-800 print:border-slate-800 print:shadow-none ${
                        repair.classification === "MAJOR" ? "bg-orange-500 hover:bg-orange-600 text-white" : ""
                      }`}>
                        {repair.classification}
                      </Badge>
                    </TableCell>
                    <TableCell className="print:py-3">
                      <div className="font-medium print:text-slate-900">{repair.item}</div>
                      <div className="text-xs text-slate-500 print:text-slate-700">{repair.issue}</div>
                      {repair.notes && <div className="text-xs text-blue-600 mt-1 italic print:text-slate-600">Note: {repair.notes}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-slate-500 text-sm">£</span>
                          <Input 
                            type="number" 
                            className="w-20 h-8 text-right px-2" 
                            value={repair.partsCost}
                            onChange={(e) => updateCost(index, 'partsCost', e.target.value)}
                          />
                        </div>
                      ) : (
                        `£${repair.partsCost.toFixed(2)}`
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-slate-500 text-sm">£</span>
                          <Input 
                            type="number" 
                            className="w-20 h-8 text-right px-2" 
                            value={repair.labourCost}
                            onChange={(e) => updateCost(index, 'labourCost', e.target.value)}
                          />
                        </div>
                      ) : (
                        `£${repair.labourCost.toFixed(2)}`
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold print:text-slate-700">
                      £{repair.estimatedTotal.toFixed(2)}
                    </TableCell>
                    <TableCell className="hidden print:table-cell border border-slate-300"></TableCell>
                    <TableCell className="hidden print:table-cell border border-slate-300 text-right pr-2 text-slate-300">£</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="bg-slate-50 rounded-b-lg p-6 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
        <div className="space-y-2 max-w-md">
          <h4 className="font-medium text-slate-700 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Mechanic Notes
          </h4>
          <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
            {estimate.mechanicNotes.map((note: string, idx: number) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
        
        <div className="bg-white border rounded-lg p-4 shadow-sm w-full md:w-auto print:border-slate-800 print:shadow-none">
          <div className="space-y-3">
            <div className="flex justify-between gap-8 items-center border-b pb-2 print:border-slate-200">
              <span className="text-sm font-medium text-slate-600 print:text-slate-800">Minimum to Pass MOT</span>
              <span className="text-lg font-bold text-red-600 print:text-black">{estimate.summary.minimumToPass}</span>
            </div>
            <div className="flex justify-between gap-8 items-center">
              <span className="text-sm font-medium text-slate-600 print:text-slate-800">Including Advisories</span>
              <span className="text-lg font-bold text-slate-900 print:text-black">{estimate.summary.withAdvisories}</span>
            </div>
          </div>
        </div>
      </CardFooter>
    </Card>
      {/* Print-only: Raw MOT Items List - Page 2 */}
      <div className="hidden print:block print:break-before-page w-full text-black">
        <div className="mb-6 border-b-2 border-slate-800 pb-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6" />
            MOT Inspection Items - Full List
          </h2>
          <p className="text-slate-600 mt-1 font-medium text-lg">Vehicle: {vehicleDetails.registration || "Unknown"} {vehicleDetails.make ? `(${vehicleDetails.make} ${vehicleDetails.model})` : ''}</p>
        </div>

        <table className="w-full border-collapse border-spacing-0 text-sm">
          <thead>
            <tr className="bg-slate-100 text-slate-800">
              <th className="text-left py-2 px-3 border border-slate-300 w-[120px] font-bold">Severity</th>
              <th className="text-left py-2 px-3 border border-slate-300 font-bold">MOT Item & Description</th>
              <th className="text-left py-2 px-3 border border-slate-300 w-[200px] font-bold">Part Number / Supplier</th>
              <th className="text-right py-2 px-3 border border-slate-300 w-[120px] font-bold">Cost £</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((defect, idx) => {
              const getBadgeColours = (type: string, dangerous: boolean | undefined) => {
                if (dangerous) return 'bg-red-600 text-white border-red-800';
                if (type === 'FAIL' || type === 'MAJOR') return 'bg-orange-500 text-white border-orange-700';
                if (type === 'PRS') return 'bg-blue-500 text-white border-blue-700';
                return 'bg-amber-100 text-amber-800 border-amber-300';
              };

              const label = defect.dangerous ? "DANGEROUS" : (defect.type === "FAIL" ? "MAJOR" : defect.type);

              return (
                <tr key={idx} className="border-b border-slate-300 break-inside-avoid">
                  <td className="border border-slate-300 py-3 px-3 align-top">
                    <span className={`inline-block px-2 py-1 text-[11px] font-bold uppercase rounded border ${getBadgeColours(defect.type, defect.dangerous)}`}>
                      {label}
                    </span>
                  </td>
                  <td className="border border-slate-300 py-3 px-3 align-top">
                    <p className="font-medium text-sm leading-snug">{defect.text}</p>
                  </td>
                  <td className="border border-slate-300 py-3 px-3 align-top text-slate-300"></td>
                  <td className="border border-slate-300 py-3 px-3 align-top text-right text-slate-300">£</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
