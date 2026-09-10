/**
 * Workshop data on a job sheet: torque settings, brake limits, alignment, fuse boxes, part
 * locations and drawings for the car on the job. The same stored data as the car page's Workshop
 * Data card (shared/workshopData.ts) — read from the car when it is already there, otherwise bought
 * once through vehicles.fetchWorkshopData, which never pays for a car twice.
 */
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { WorkshopDataCard } from "@/components/WorkshopDataCard";
import { trpc } from "@/lib/trpc";
import type { WorkshopData } from "../../../shared/workshopData";

export type WorkshopDataState = {
    workshop: WorkshopData | null;
    loading: boolean;
    failed: boolean;
    /** Fetch now. `retry` allows another attempt after a failure; a car already stored costs nothing. */
    fetch: (retry?: boolean) => void;
};

const normReg = (r?: string | null) => String(r || "").replace(/\s/g, "").toUpperCase();

/**
 * The workshop data for a registration. `initial` is whatever the page already holds for the car;
 * `auto` fetches it straight away when missing (a current job, where the car is in the workshop).
 */
export function useWorkshopData(registration: string | null | undefined, initial?: WorkshopData | null, opts?: { auto?: boolean }): WorkshopDataState {
    const reg = normReg(registration);
    const [fetched, setFetched] = useState<{ reg: string; workshop: WorkshopData } | null>(null);
    const triedRef = useRef<string>("");
    const mutation = trpc.vehicles.fetchWorkshopData.useMutation({
        onSuccess: (r: any, vars) => { if (r?.workshop) setFetched({ reg: normReg(vars.registration), workshop: r.workshop }); },
    });
    const workshop = initial ?? (fetched && fetched.reg === reg ? fetched.workshop : null);

    const fetch = (retry = false) => {
        if (!reg || workshop || mutation.isPending) return;
        if (triedRef.current === reg && !retry) return;
        triedRef.current = reg;
        mutation.mutate({ registration: reg });
    };

    useEffect(() => {
        if (opts?.auto) fetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reg, opts?.auto, !!initial]);

    return { workshop, loading: mutation.isPending, failed: mutation.isError, fetch };
}

/** A slide-over panel so the job sheet stays where it is. Opening it fetches the data if needed. */
export function WorkshopDataSheet({ open, onOpenChange, registration, data }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    registration?: string | null;
    data: WorkshopDataState;
}) {
    useEffect(() => {
        if (open) data.fetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
                <SheetHeader className="border-b">
                    <SheetTitle>Workshop Data{registration ? ` · ${normReg(registration)}` : ""}</SheetTitle>
                    <SheetDescription>Torque settings, brake limits, wheel alignment, fuse boxes, part locations and drawings.</SheetDescription>
                </SheetHeader>
                <div className="p-3">
                    {!normReg(registration) ? (
                        <p className="text-sm text-muted-foreground">Add the registration to see this car's workshop data.</p>
                    ) : (
                        <>
                            <WorkshopDataCard workshop={data.workshop} loading={data.loading} onFetch={() => data.fetch(true)} vehicleLabel={normReg(registration)} />
                            {data.failed && !data.workshop && (
                                <p className="mt-2 text-xs text-muted-foreground">Could not fetch workshop data for this car. It may not be on file yet, or the technical data service did not answer.</p>
                            )}
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
