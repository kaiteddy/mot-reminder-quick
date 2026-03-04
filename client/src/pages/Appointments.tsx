import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { format, addDays, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, Plus, GripVertical, CheckCircle2, Loader2, User, Phone, Car } from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { trpc } from "@/lib/trpc";
import { APP_TITLE } from "@/const";
import { Badge } from "@/components/ui/badge";
import { ManufacturerLogo } from "@/components/ManufacturerLogo";

// Define our resource columns (bays/ramps)
const BAYS = [
    { id: "mot-bay", name: "MOT Bay", },
    { id: "ramp-1", name: "Ramp 1", },
    { id: "ramp-2", name: "Ramp 2", },
    { id: "ramp-3", name: "Ramp 3", },
    { id: "waitlist", name: "Waitlist / Unassigned" }
];

const MOT_SLOTS = [
    { id: "08:30", label: "08:30 - 09:30", start: "08:30", end: "09:30" },
    { id: "09:30", label: "09:30 - 10:30", start: "09:30", end: "10:30" },
    { id: "11:00", label: "11:00 - 12:00", start: "11:00", end: "12:00" },
    { id: "12:00", label: "12:00 - 13:00", start: "12:00", end: "13:00" },
    { id: "14:00", label: "14:00 - 15:00", start: "14:00", end: "15:00" },
    { id: "15:00", label: "15:00 - 16:00", start: "15:00", end: "16:00" },
    { id: "16:00", label: "16:00 - 17:00", start: "16:00", end: "17:00" }
];

const RAMP_SLOTS: { id: string; label: string; start: string; end: string }[] = [];
for (let h = 8; h <= 17; h++) {
    for (let m = (h === 8 ? 30 : 0); m < 60; m += 15) {
        if (h === 17 && m > 30) continue;
        const start = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        let nextH = h, nextM = m + 15;
        if (nextM === 60) { nextM = 0; nextH++; }
        const end = `${nextH.toString().padStart(2, '0')}:${nextM.toString().padStart(2, '0')}`;
        RAMP_SLOTS.push({ id: start, label: start, start, end });
    }
}


export default function Appointments() {
    const [currentDate, setCurrentDate] = useState<Date>(new Date());
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
    const dateStr = format(currentDate, "yyyy-MM-dd");

    const [formData, setFormData] = useState({
        registration: "",
        bayId: "mot-bay",
        startTime: "09:00",
        endTime: "09:45",
        notes: "",
        status: "scheduled",
        appointmentDate: dateStr,
        customerName: "",
        customerPhone: "",
        vehicleMake: "",
        vehicleModel: ""
    });

    // State to hold optimistic drag-and-drop list state
    const [localAppointments, setLocalAppointments] = useState<any[]>([]);

    const utils = trpc.useUtils();
    const { data: serverAppointments, isLoading } = trpc.appointments.listByDate.useQuery({ date: dateStr });

    // Update local state when server data changes (but not while dragging ideally)
    useEffect(() => {
        if (serverAppointments) {
            setLocalAppointments(serverAppointments);
        }
    }, [serverAppointments]);

    // Mutations
    const createMutation = trpc.appointments.create.useMutation({
        onSuccess: () => {
            toast.success("Appointment created!");
            setIsCreateOpen(false);
            resetForm();
            utils.appointments.listByDate.invalidate({ date: dateStr });
        },
        onError: (e) => toast.error(`Failed to create: ${e.message}`)
    });

    const updatePosMutation = trpc.appointments.updatePosition.useMutation();
    const updateDetailsMutation = trpc.appointments.updateDetails.useMutation({
        onSuccess: () => {
            toast.success("Appointment updated!");
            setIsEditOpen(false);
            resetForm();
            utils.appointments.listByDate.invalidate({ date: dateStr });
        },
        onError: (e) => toast.error(`Failed to update: ${e.message}`)
    });

    const deleteMutation = trpc.appointments.delete.useMutation({
        onSuccess: () => {
            toast.success("Appointment deleted!");
            setIsEditOpen(false);
            utils.appointments.listByDate.invalidate({ date: dateStr });
        }
    });

    // Vehicle Lookup for quick populate
    const { data: vehicleLookup, isFetched: isLocalFetched } = trpc.vehicles.getByRegistration.useQuery(
        { registration: formData.registration.replace(/\s+/g, "") },
        { enabled: formData.registration.length >= 2, retry: false }
    );

    // Fallback external lookup (DVLA/UKVD) if local not found
    const strippedReg = formData.registration.replace(/\s+/g, "");
    const { data: externalLookup, isLoading: isExternalLoading } = trpc.vehicles.lookupExternal.useQuery(
        { registration: strippedReg },
        {
            enabled: strippedReg.length >= 5 && isLocalFetched && vehicleLookup === null,
            retry: false
        }
    );

    // Populate new vehicle details automatically from external DVLA match
    useEffect(() => {
        if (externalLookup && !vehicleLookup) {
            setFormData(prev => ({
                ...prev,
                vehicleMake: prev.vehicleMake || externalLookup.make || "",
                vehicleModel: prev.vehicleModel || externalLookup.model || ""
            }));
        }
    }, [externalLookup, vehicleLookup]);

    const resetForm = () => {
        setFormData({
            registration: "",
            bayId: "mot-bay",
            startTime: "09:00",
            endTime: "09:45",
            notes: "",
            status: "scheduled",
            appointmentDate: dateStr,
            customerName: "",
            customerPhone: "",
            vehicleMake: "",
            vehicleModel: ""
        });
        setSelectedAppointment(null);
    };

    const nextDay = () => setCurrentDate(addDays(currentDate, 1));
    const prevDay = () => setCurrentDate(subDays(currentDate, 1));
    const today = () => setCurrentDate(new Date());

    const handleDragEnd = (result: DropResult) => {
        const { source, destination, draggableId } = result;

        if (!destination) return; // Dropped outside a list

        // If dropped in the same place
        if (source.droppableId === destination.droppableId && source.index === destination.index) {
            return;
        }

        const getRealBayId = (dndId: string) => dndId.includes('|') ? dndId.split('|')[0] : dndId;
        const getSlotTime = (dndId: string) => dndId.includes('|') ? dndId.split('|')[1] : null;

        const targetDroppableId = destination.droppableId;
        const targetBayId = getRealBayId(targetDroppableId);
        const slotTime = getSlotTime(targetDroppableId);

        // Optimistically update local array
        const draggedApptId = parseInt(draggableId.replace("appt-", ""));
        const draggedAppt = localAppointments.find(a => a.id === draggedApptId);
        if (!draggedAppt) return;

        // Remove from source array and mutate bay ID
        let newAppts = localAppointments.filter(a => a.id !== draggedApptId);

        const updatedAppt = { ...draggedAppt, bayId: targetBayId };

        // Auto-assign start and end times if dropped into a specific slot
        if (slotTime && slotTime !== 'other') {
            updatedAppt.startTime = slotTime;
            const isMot = targetBayId === 'mot-bay';
            const slotObj = isMot ? MOT_SLOTS.find(s => s.start === slotTime) : RAMP_SLOTS.find(s => s.start === slotTime);

            if (isMot && slotObj) {
                updatedAppt.endTime = slotObj.end;
            } else if (!isMot && slotObj) {
                if (!draggedAppt.startTime || !draggedAppt.endTime) {
                    updatedAppt.endTime = slotObj.end; // default 15min block if dragging unassigned
                } else {
                    // try to keep previous duration
                    const startMins = parseInt(draggedAppt.startTime.split(':')[0]) * 60 + parseInt(draggedAppt.startTime.split(':')[1]);
                    const endMins = parseInt(draggedAppt.endTime.split(':')[0]) * 60 + parseInt(draggedAppt.endTime.split(':')[1]);
                    const diff = endMins - startMins > 0 ? endMins - startMins : 60;

                    let newStartMins = parseInt(slotTime.split(':')[0]) * 60 + parseInt(slotTime.split(':')[1]);
                    let newEndMins = Math.min(newStartMins + diff, 18 * 60);
                    updatedAppt.endTime = `${Math.floor(newEndMins / 60).toString().padStart(2, '0')}:${(newEndMins % 60).toString().padStart(2, '0')}`;
                }
            }
        }

        // Determine destination list (filter by the exact sub-droppable)
        let destList;
        if (targetBayId === 'mot-bay') {
            const destSlotTime = slotTime || 'other';
            destList = newAppts.filter(a => {
                if (a.bayId !== targetBayId) return false;
                const matchesStandard = MOT_SLOTS.some(s => s.start === a.startTime);
                return destSlotTime === 'other' ? !matchesStandard : a.startTime === destSlotTime;
            });
        } else if (targetBayId.startsWith('ramp')) {
            const destSlotTime = slotTime || 'other';
            destList = newAppts.filter(a => {
                if (a.bayId !== targetBayId) return false;
                const matchesStandard = RAMP_SLOTS.some(s => s.start === a.startTime);
                return destSlotTime === 'other' ? !matchesStandard : a.startTime === destSlotTime;
            });
        } else {
            destList = newAppts.filter(a => a.bayId === targetBayId);
        }

        // Sort it
        destList.sort((a, b) => a.orderIndex - b.orderIndex);

        // Re-insert into destList array with updated order
        destList.splice(destination.index, 0, updatedAppt);

        // Normalize order index
        destList.forEach((item, index) => {
            item.orderIndex = index;
        });

        // Reconstruct full list (careful not to duplicate items if they were in the same bay already)
        const destItemIds = new Set(destList.map(a => a.id));
        const remainingAppts = newAppts.filter(a => !destItemIds.has(a.id));
        setLocalAppointments([...remainingAppts, ...destList]);

        // Send backend mutation for drag position
        updatePosMutation.mutate({
            id: draggedApptId,
            bayId: targetBayId,
            orderIndex: destination.index
        });

        // If time changed, trigger updateDetails silently
        if (slotTime && slotTime !== 'other') {
            updateDetailsMutation.mutate({
                id: draggedApptId,
                startTime: updatedAppt.startTime,
                endTime: updatedAppt.endTime,
                status: updatedAppt.status
            });
        }

        // Update other order indexes in destination list
        destList.forEach((item, index) => {
            if (item.id !== draggedApptId) {
                updatePosMutation.mutate({
                    id: item.id,
                    bayId: targetBayId,
                    orderIndex: index
                });
            }
        });
    };

    const handleSaveCreate = () => {
        if (!formData.registration && !formData.notes) {
            toast.error("Please provide at least a registration or notes");
            return;
        }
        createMutation.mutate({
            ...formData,
            appointmentDate: formData.appointmentDate ? new Date(formData.appointmentDate).toISOString() : new Date().toISOString(),
            vehicleId: vehicleLookup?.vehicle?.id || undefined,
            customerId: vehicleLookup?.customer?.id || undefined,
            customerName: formData.customerName,
            customerPhone: formData.customerPhone,
            vehicleMake: formData.vehicleMake,
            vehicleModel: formData.vehicleModel,
        });
    };

    const handleSaveEdit = () => {
        if (!selectedAppointment) return;

        const parsedDate = new Date(formData.appointmentDate || dateStr).toISOString();

        updateDetailsMutation.mutate({
            id: selectedAppointment.id,
            registration: formData.registration,
            startTime: formData.startTime,
            endTime: formData.endTime,
            notes: formData.notes,
            status: formData.status as any,
            appointmentDate: parsedDate,
            vehicleId: vehicleLookup?.vehicle?.id || undefined,
            customerId: vehicleLookup?.customer?.id || undefined,
            customerName: formData.customerName,
            customerPhone: formData.customerPhone,
            vehicleMake: formData.vehicleMake,
            vehicleModel: formData.vehicleModel,
        });
    };

    const openCreateDialog = (bayId: string = "mot-bay", slotStart?: string) => {
        resetForm();
        setFormData(prev => {
            const updates: any = { bayId };
            if (slotStart && slotStart !== "other") {
                const slot = MOT_SLOTS.find(s => s.start === slotStart);
                if (slot) {
                    updates.startTime = slot.start;
                    updates.endTime = slot.end;
                }
            }
            return { ...prev, ...updates };
        });
        setIsCreateOpen(true);
    };

    const openApptEdit = (appt: any) => {
        setSelectedAppointment(appt);
        setFormData({
            registration: appt.registration || "",
            bayId: appt.bayId,
            startTime: appt.startTime || "",
            endTime: appt.endTime || "",
            notes: appt.notes || "",
            status: appt.status || "scheduled",
            appointmentDate: appt.appointmentDate ? format(new Date(appt.appointmentDate), "yyyy-MM-dd") : dateStr,
            customerName: appt.customer?.name || "",
            customerPhone: appt.customer?.phone || "",
            vehicleMake: appt.vehicle?.make || "",
            vehicleModel: appt.vehicle?.model || ""
        });
        setIsEditOpen(true);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'in_progress': return "bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300";
            case 'completed': return "bg-green-100 border-green-300 text-green-800 dark:bg-green-900/40 dark:border-green-700 dark:text-green-300";
            case 'cancelled': return "bg-red-100 border-red-300 text-red-800 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300";
            default: return "";
        }
    };

    return (
        <DashboardLayout>
            <div className="flex flex-col h-[calc(100vh-6rem)]">
                {/* Header Options */}
                <div className="flex-shrink-0 flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Calendar & Kanban</h1>
                        <p className="text-muted-foreground">Manage bookings seamlessly across your ramps and bays.</p>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="flex items-center bg-background border rounded-md shadow-sm">
                            <Button variant="ghost" size="icon" onClick={prevDay}>
                                <ChevronLeft className="w-5 h-5" />
                            </Button>
                            <div className="flex items-center px-4 py-2 text-sm font-medium border-x select-none cursor-pointer hover:bg-accent hover:text-accent-foreground" onClick={today}>
                                <CalendarIcon className="w-4 h-4 mr-2" />
                                {format(currentDate, "EEEE, do MMM yyyy")}
                            </div>
                            <Button variant="ghost" size="icon" onClick={nextDay}>
                                <ChevronRight className="w-5 h-5" />
                            </Button>
                        </div>
                        <Button onClick={() => openCreateDialog("waitlist")}>
                            <Plus className="w-4 h-4 mr-2" />
                            New Booking
                        </Button>
                    </div>
                </div>

                {/* Drag and drop Container */}
                <div className="flex-1 min-h-0 relative">
                    <DragDropContext onDragEnd={handleDragEnd}>
                        <div className="flex h-full gap-4 overflow-x-auto pb-2">
                            {BAYS.map((bay) => {
                                const bayAppts = localAppointments
                                    .filter(a => a.bayId === bay.id)
                                    .sort((a, b) => a.orderIndex - b.orderIndex);

                                const renderDraggableList = (droppableId: string, list: any[]) => (
                                    <Droppable droppableId={droppableId}>
                                        {(provided: any, snapshot: any) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.droppableProps}
                                                className={`flex-1 p-2 overflow-y-auto min-h-[50px] transition-colors ${snapshot.isDraggingOver ? "bg-slate-100/80 dark:bg-slate-800/80 shadow-inner" : ""}`}
                                            >
                                                {list.map((appt, index) => (
                                                    <Draggable key={`appt-${appt.id}`} draggableId={`appt-${appt.id}`} index={index}>
                                                        {(provided: any, snapshot: any) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                className={`mb-2 ${snapshot.isDragging ? "z-50 opacity-90 scale-105" : ""}`}
                                                            >
                                                                <Card className={`group cursor-default border shadow-sm transition-all hover:border-slate-300 dark:hover:border-slate-700 ${getStatusColor(appt.status)}`}>
                                                                    <CardContent className="p-1.5">
                                                                        <div className="flex items-start gap-1">
                                                                            <div
                                                                                {...provided.dragHandleProps}
                                                                                className="mt-0.5 flex-shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors"
                                                                            >
                                                                                <GripVertical className="w-3.5 h-3.5" />
                                                                            </div>
                                                                            <div className="flex-1 min-w-0" onClick={() => openApptEdit(appt)}>
                                                                                <div className="flex items-center justify-between mb-0.5 cursor-pointer">
                                                                                    {appt.registration ? (
                                                                                        <div className="flex items-center gap-1.5">
                                                                                            <div className="font-mono font-bold text-xs tracking-wide bg-yellow-400 text-black px-1 py-0 rounded-sm shadow-sm flex items-center">
                                                                                                {appt.registration}
                                                                                            </div>
                                                                                            {appt.vehicle?.make && (
                                                                                                <div className="flex items-center">
                                                                                                    <ManufacturerLogo make={appt.vehicle.make} size="sm" showName className="text-[10px]" />
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="font-medium text-xs italic text-muted-foreground">No Reg</div>
                                                                                    )}
                                                                                    {appt.startTime && (
                                                                                        <div className="flex items-center text-[10px] font-semibold text-slate-600 dark:text-slate-400 bg-background/60 px-1 py-0.5 rounded">
                                                                                            <Clock className="w-2.5 h-2.5 mr-1 opacity-70" />
                                                                                            {appt.startTime}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                                {appt.vehicle && (
                                                                                    <div className="flex items-center text-[10px] text-muted-foreground mt-0.5 mb-0 font-medium truncate">
                                                                                        <Car className="w-2.5 h-2.5 mr-1 opacity-70 flex-shrink-0" />
                                                                                        <span className="truncate">{appt.vehicle.model || "Unknown Model"}</span>
                                                                                    </div>
                                                                                )}
                                                                                {appt.customer && (
                                                                                    <div className="flex flex-col gap-0 mt-0.5 border-t pt-0.5 border-slate-100 dark:border-slate-800">
                                                                                        <div className="flex items-center text-[9px] text-slate-500 font-medium truncate">
                                                                                            <User className="w-2.5 h-2.5 mr-1 opacity-70 flex-shrink-0" />
                                                                                            <span className="truncate">{appt.customer.name}</span>
                                                                                        </div>
                                                                                        {appt.customer.phone && (
                                                                                            <div className="flex items-center text-[9px] text-slate-500 font-medium truncate">
                                                                                                <Phone className="w-2.5 h-2.5 mr-1 opacity-70 flex-shrink-0" />
                                                                                                <span className="truncate">{appt.customer.phone}</span>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                                {appt.notes && (
                                                                                    <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5 leading-tight cursor-pointer bg-slate-50/50 dark:bg-slate-900/50 rounded px-1 py-0.5">
                                                                                        {appt.notes}
                                                                                    </p>
                                                                                )}
                                                                                {appt.status !== 'scheduled' && (
                                                                                    <Badge variant="outline" className="mt-1 text-[8px] uppercase tracking-wider py-0 px-1 leading-none shadow-none">
                                                                                        {appt.status.replace("_", " ")}
                                                                                    </Badge>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </CardContent>
                                                                </Card>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                                {list.length === 0 && !snapshot.isDraggingOver && (
                                                    <div
                                                        className="h-full min-h-[30px] flex items-center justify-center text-slate-400 cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-900/40 rounded transition-colors"
                                                        onClick={() => {
                                                            const isSlot = droppableId.includes('|');
                                                            const actualBayId = isSlot ? droppableId.split('|')[0] : droppableId;
                                                            openCreateDialog(actualBayId, isSlot ? droppableId.split('|')[1] : undefined);
                                                        }}
                                                    >
                                                        <p className="text-[10px] font-medium px-2 text-center border border-dashed border-transparent group-hover:border-slate-300 dark:group-hover:border-slate-700 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                                            + Book
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </Droppable>
                                );

                                return (
                                    <div key={bay.id} className="flex-shrink-0 w-80 flex flex-col bg-slate-50/50 dark:bg-slate-900/50 border rounded-xl overflow-hidden">
                                        <div className="px-4 py-3 bg-slate-100 dark:bg-slate-900 border-b flex items-center justify-between shadow-sm z-10 sticky top-0">
                                            <h3 className="font-semibold text-sm tracking-wide">{bay.name}</h3>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="px-1.5 min-w-6 justify-center bg-background/80 shadow-sm">{bayAppts.length}</Badge>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 text-slate-500 hover:text-slate-900" onClick={() => openCreateDialog(bay.id)}>
                                                    <Plus className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        {bay.id === 'mot-bay' || bay.id.startsWith('ramp') ? (
                                            <div className="flex-1 overflow-y-auto p-1.5 space-y-2 pb-6">
                                                {[...(bay.id === 'mot-bay' ? MOT_SLOTS : RAMP_SLOTS), { id: "other", label: "Other / Manual Times", start: "other", end: "" }].map(slot => {
                                                    const slotAppts = bayAppts.filter(a => {
                                                        const slotArray = bay.id === 'mot-bay' ? MOT_SLOTS : RAMP_SLOTS;
                                                        const isStandardSlot = slotArray.some(s => s.start === a.startTime);
                                                        return slot.id === "other" ? !isStandardSlot : a.startTime === slot.start;
                                                    });

                                                    return (
                                                        <div key={`${bay.id}|${slot.id}`} className="bg-white/40 dark:bg-black/20 rounded-md border shadow-sm pb-1 overflow-hidden">
                                                            <div
                                                                className="bg-slate-100/80 dark:bg-slate-800/80 text-[10px] font-semibold text-slate-500 tracking-wider px-2 py-1 border-b flex justify-between items-center cursor-pointer hover:bg-slate-200/80 dark:hover:bg-slate-700/80 transition-colors"
                                                                onClick={() => {
                                                                    if (slotAppts.length === 1) {
                                                                        openApptEdit(slotAppts[0]);
                                                                    } else {
                                                                        openCreateDialog(bay.id, slot.start);
                                                                    }
                                                                }}
                                                            >
                                                                <span>{bay.id === 'mot-bay' ? slot.label : slot.label === "Other / Manual Times" ? slot.label : slot.start}</span>
                                                                {slotAppts.length > 0 && <span className="text-[9px] bg-white dark:bg-slate-700 shadow-sm px-1.5 rounded-sm">{slotAppts.length}</span>}
                                                            </div>
                                                            {renderDraggableList(`${bay.id}|${slot.id}`, slotAppts)}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="flex-1 overflow-y-auto">
                                                {renderDraggableList(bay.id, bayAppts)}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </DragDropContext>
                </div>
            </div>

            {/* CREATE BOOKING DIALOG */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="sm:max-w-[550px]">
                    <DialogHeader>
                        <DialogTitle>Quick Booking</DialogTitle>
                        <DialogDescription>
                            Create an appointment for {format(currentDate, "do MMM yyyy")}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-5 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="reg" className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Registration Number</Label>
                            <Input
                                id="reg"
                                className="font-mono uppercase transition-colors h-11 text-lg"
                                placeholder="e.g. XX12 XXX"
                                value={formData.registration}
                                onChange={(e) => setFormData({ ...formData, registration: e.target.value.toUpperCase() })}
                            />
                        </div>

                        {/* Auto-fill details if known */}
                        {vehicleLookup?.vehicle?.registration && (
                            <div className="bg-green-50 text-green-800 px-3 py-2.5 rounded-lg flex items-center justify-between border border-green-200">
                                <span className="font-medium text-sm truncate mr-2">
                                    {vehicleLookup.customer?.name || 'Unknown Cust.'} • {vehicleLookup.vehicle?.make || ''} {vehicleLookup.vehicle?.model || ''}
                                </span>
                                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                            </div>
                        )}

                        {formData.registration.length >= 2 && !vehicleLookup?.vehicle && (
                            <div className="space-y-3 border border-slate-200 dark:border-slate-800 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">New Vehicle Details</p>
                                        {isExternalLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                                    </div>
                                    <Badge variant="outline" className="text-[9px] bg-background">Required</Badge>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] text-muted-foreground uppercase">Make</Label>
                                        <Input
                                            placeholder="e.g. Ford"
                                            className="h-9 text-sm"
                                            value={formData.vehicleMake}
                                            onChange={(e) => setFormData({ ...formData, vehicleMake: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] text-muted-foreground uppercase">Model</Label>
                                        <Input
                                            placeholder="e.g. Focus"
                                            className="h-9 text-sm"
                                            value={formData.vehicleModel}
                                            onChange={(e) => setFormData({ ...formData, vehicleModel: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5 col-span-2">
                                        <Label className="text-[11px] text-muted-foreground uppercase">Customer Name</Label>
                                        <Input
                                            placeholder="Full Name"
                                            className="h-9 text-sm"
                                            value={formData.customerName}
                                            onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5 col-span-2">
                                        <Label className="text-[11px] text-muted-foreground uppercase">Contact Number</Label>
                                        <Input
                                            placeholder="Phone Number"
                                            className="h-9 text-sm"
                                            value={formData.customerPhone}
                                            onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="bay" className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Bay / Ramp</Label>
                                <Select value={formData.bayId} onValueChange={(v) => setFormData({ ...formData, bayId: v })}>
                                    <SelectTrigger className="h-10">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {BAYS.map(b => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="time" className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Time</Label>
                                {formData.bayId === 'mot-bay' ? (
                                    <Select
                                        value={MOT_SLOTS.find(s => s.start === formData.startTime)?.id || ""}
                                        onValueChange={(val) => {
                                            const slot = MOT_SLOTS.find(s => s.id === val);
                                            if (slot) setFormData(prev => ({ ...prev, startTime: slot.start, endTime: slot.end }));
                                        }}
                                    >
                                        <SelectTrigger className="h-10">
                                            <SelectValue placeholder="Select Slot" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {MOT_SLOTS.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="time"
                                            value={formData.startTime}
                                            onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                                            className="w-full h-10 text-center"
                                        />
                                        <span className="text-muted-foreground font-medium">-</span>
                                        <Input
                                            type="time"
                                            value={formData.endTime}
                                            onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                                            className="w-full h-10 text-center"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="notes" className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Notes & Job Details</Label>
                            <Textarea
                                id="notes"
                                placeholder="Describe the work required, contact instructions, etc..."
                                className="resize-none h-24 text-sm"
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveCreate} disabled={createMutation.isPending}>
                            {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Save Booking
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* EDIT BOOKING DIALOG */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-[550px]">
                    <DialogHeader>
                        <DialogTitle>Booking Details</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-5 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="edit-date" className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Date</Label>
                                <Input
                                    type="date"
                                    id="edit-date"
                                    value={formData.appointmentDate}
                                    onChange={(e) => setFormData({ ...formData, appointmentDate: e.target.value })}
                                    className="h-10 text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Status</Label>
                                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                                    <SelectTrigger className="h-10 text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="scheduled">Scheduled (Blue)</SelectItem>
                                        <SelectItem value="in_progress">In Progress (Orange)</SelectItem>
                                        <SelectItem value="completed">Completed (Green)</SelectItem>
                                        <SelectItem value="cancelled">Cancelled (Red)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="edit-reg" className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Registration Number</Label>
                            <Input
                                id="edit-reg"
                                className="font-mono uppercase transition-colors h-11 text-lg"
                                value={formData.registration}
                                onChange={(e) => setFormData({ ...formData, registration: e.target.value.toUpperCase() })}
                            />
                        </div>

                        {formData.registration.length >= 2 && !vehicleLookup?.vehicle && (
                            <div className="space-y-3 border border-slate-200 dark:border-slate-800 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Link Vehicle Details</p>
                                        {isExternalLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                                    </div>
                                    <Badge variant="outline" className="text-[9px] bg-background">Required</Badge>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] text-muted-foreground uppercase">Make</Label>
                                        <Input
                                            placeholder="e.g. Ford"
                                            className="h-9 text-sm"
                                            value={formData.vehicleMake}
                                            onChange={(e) => setFormData({ ...formData, vehicleMake: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] text-muted-foreground uppercase">Model</Label>
                                        <Input
                                            placeholder="e.g. Focus"
                                            className="h-9 text-sm"
                                            value={formData.vehicleModel}
                                            onChange={(e) => setFormData({ ...formData, vehicleModel: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5 col-span-2">
                                        <Label className="text-[11px] text-muted-foreground uppercase">Customer Name</Label>
                                        <Input
                                            placeholder="Full Name"
                                            className="h-9 text-sm"
                                            value={formData.customerName}
                                            onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5 col-span-2">
                                        <Label className="text-[11px] text-muted-foreground uppercase">Contact Number</Label>
                                        <Input
                                            placeholder="Phone Number"
                                            className="h-9 text-sm"
                                            value={formData.customerPhone}
                                            onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="edit-time" className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Time Allocation</Label>
                            {formData.bayId === 'mot-bay' ? (
                                <Select
                                    value={MOT_SLOTS.find(s => s.start === formData.startTime)?.id || ""}
                                    onValueChange={(val) => {
                                        const slot = MOT_SLOTS.find(s => s.id === val);
                                        if (slot) setFormData(prev => ({ ...prev, startTime: slot.start, endTime: slot.end }));
                                    }}
                                >
                                    <SelectTrigger className="h-10 text-sm">
                                        <SelectValue placeholder="Select MOT Slot" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {MOT_SLOTS.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <Input
                                        type="time"
                                        value={formData.startTime}
                                        onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                                        className="h-10 text-center text-sm w-full"
                                    />
                                    <span className="text-muted-foreground font-medium">-</span>
                                    <Input
                                        type="time"
                                        value={formData.endTime}
                                        onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                                        className="h-10 text-center text-sm w-full"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="edit-notes" className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Notes & Job Details</Label>
                            <Textarea
                                id="edit-notes"
                                className="resize-none h-28 text-sm"
                                placeholder="Describe the work required, contact instructions, etc..."
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter className="flex justify-between w-full sm:justify-between">
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                                if (window.confirm("Delete this appointment completely?")) {
                                    deleteMutation.mutate({ id: selectedAppointment?.id });
                                }
                            }}
                        >
                            Delete
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                            <Button onClick={handleSaveEdit} disabled={updateDetailsMutation.isPending}>
                                Save Changes
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
}
