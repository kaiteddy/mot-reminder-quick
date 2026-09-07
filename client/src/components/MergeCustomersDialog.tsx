import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { GitMerge, Loader2, AlertTriangle, Car, FileText, Search } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: number; name: string; phone: string | null; email: string | null;
  postcode: string | null; address: string | null; accountNumber: string | null;
  optedOut: number | null; vehicles: number; documents: number; lastSeen: string | null;
  // Found on the customer's own invoices rather than on the record — see searchCustomersForMerge.
  docPhone: string | null; docEmail: string | null;
};

const acct = (r: Row) => String(r.accountNumber || "").trim().toUpperCase();
const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Review every customer matching a search term, and fold the duplicates into one record.
 *
 *  The search dropdown can only ever show a list — four rows all reading "Mr Richard Doneo" tell
 *  you nothing about which to pick. This shows what actually hangs off each: the GA4 account
 *  number, the address, how many vehicles and invoices. Hendon Service Centre reached eight
 *  records this way, under two spellings and six account numbers, with no shared phone number
 *  between them, so neither the Duplicates page (which groups on phone) nor the linked-accounts
 *  merge on the customer page could see them.
 */
export default function MergeCustomersDialog({
  open, term, onOpenChange, onMerged,
}: {
  open: boolean;
  term: string;
  onOpenChange: (v: boolean) => void;
  onMerged?: (survivor: { id: number; name: string }) => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.customers.searchForMerge.useQuery(
    { query: term }, { enabled: open && term.trim().length >= 2 });
  const rows: Row[] = (data as any) || [];

  const [keepId, setKeepId] = useState<number | null>(null);
  const [fold, setFold] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // The heaviest record survives by default — the one carrying the vehicles and the history.
  useEffect(() => {
    if (!rows.length) return;
    setKeepId((cur) => (cur && rows.some((r) => r.id === cur) ? cur : rows[0].id));
    setFold(new Set());
    setConfirmed(false);
  }, [data]);

  const keep = rows.find((r) => r.id === keepId) || null;
  const chosen = useMemo(() => rows.filter((r) => fold.has(r.id) && r.id !== keepId), [rows, fold, keepId]);

  // Every number and address going into this merge, wherever it was found. A record with nothing
  // on it can still have a mobile sitting on its invoices, and without offering it here the merge
  // would produce a survivor nobody can reach.
  const opts = (field: "phone" | "docPhone" | "email" | "docEmail", from: "record" | "invoices") =>
    [keep, ...chosen].filter(Boolean).map((r) => ({ value: String((r as Row)[field] || "").trim(), from }))
      .filter((o) => o.value);
  const dedupe = (list: { value: string; from: string }[]) => {
    const seen = new Set<string>();
    return list.filter((o) => {
      const k = o.value.replace(/\s+/g, "").toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  };
  const phoneOpts = dedupe([...opts("phone", "record"), ...opts("docPhone", "invoices")]);
  const emailOpts = dedupe([...opts("email", "record"), ...opts("docEmail", "invoices")]);

  // Default to whatever is available, preferring what's already on a record over the paperwork.
  useEffect(() => {
    setPhone((p) => (phoneOpts.some((o) => o.value === p) ? p : phoneOpts[0]?.value ?? ""));
    setEmail((e) => (emailOpts.some((o) => o.value === e) ? e : emailOpts[0]?.value ?? ""));
  }, [keepId, fold, data]);

  // mergeCustomerRecords refuses to cross GA4 account numbers unless forced, and rightly — two
  // different account numbers usually mean two different customers. Here they usually mean one
  // customer entered six times, so the override is offered, but only behind an explicit tick.
  const accts = Array.from(new Set([keep, ...chosen].filter(Boolean).map((r) => acct(r as Row)).filter(Boolean)));
  const crossesAccounts = accts.length > 1;

  const merge = trpc.customers.merge.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Merged ${chosen.length} record${chosen.length === 1 ? "" : "s"} into "${r.name}"`);
      utils.customers.searchForMerge.invalidate();
      utils.customers.search.invalidate();
      if (keep) onMerged?.({ id: keep.id, name: r.name || keep.name });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "Merge failed"),
  });

  const toggle = (id: number) => setFold((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" /> Every customer matching “{term}”
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 justify-center py-14 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Searching…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-14 text-center text-muted-foreground">Nothing matches that.</p>
        ) : (
          <>
            <p className="text-[13px] text-muted-foreground -mt-1">
              Pick the record to <b>keep</b>, then tick the ones to fold into it. Their vehicles,
              invoices, reminders and messages all move across; their phone numbers and emails are
              kept on the survivor as alternative contacts. Nothing is lost but the duplicate row.
            </p>

            <div className="max-h-[46vh] overflow-auto rounded border border-slate-200">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-[12px] text-slate-500">
                    <th className="px-2 py-1.5 w-14">Keep</th>
                    <th className="px-2 py-1.5 w-14">Fold in</th>
                    <th className="px-2 py-1.5">Customer</th>
                    <th className="px-2 py-1.5">Account</th>
                    <th className="px-2 py-1.5">Address</th>
                    <th className="px-2 py-1.5 text-right">Vehicles</th>
                    <th className="px-2 py-1.5 text-right">Invoices</th>
                    <th className="px-2 py-1.5 whitespace-nowrap">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isKeep = r.id === keepId;
                    return (
                      <tr key={r.id} className={`border-t border-slate-100 ${isKeep ? "bg-violet-50/60" : fold.has(r.id) ? "bg-amber-50/50" : ""}`}>
                        <td className="px-2 py-1.5">
                          <input type="radio" name="keep" checked={isKeep}
                            onChange={() => { setKeepId(r.id); toggle(r.id); setFold((s) => { const n = new Set(s); n.delete(r.id); return n; }); }} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="checkbox" disabled={isKeep} checked={!isKeep && fold.has(r.id)} onChange={() => toggle(r.id)} />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium whitespace-nowrap">{r.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {[r.phone, r.email].filter(Boolean).join(" · ")
                              || (r.docPhone || r.docEmail
                                ? <span className="text-amber-700">{[r.docPhone, r.docEmail].filter(Boolean).join(" · ")} <span className="text-muted-foreground">— from invoices, not on the record</span></span>
                                : "no phone or email anywhere")}
                            {r.optedOut ? <Badge variant="outline" className="ml-1 text-[10px] border-red-300 text-red-700">opted out</Badge> : null}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[12px]">{r.accountNumber || "—"}</td>
                        <td className="px-2 py-1.5 text-[12px] text-muted-foreground">
                          <span className="block max-w-[19rem] truncate" title={[r.address, r.postcode].filter(Boolean).join(", ")}>
                            {[r.address, r.postcode].filter(Boolean).join(", ") || "—"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.vehicles}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.documents}</td>
                        <td className="px-2 py-1.5 text-[12px] text-muted-foreground whitespace-nowrap">{when(r.lastSeen)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {chosen.length > 0 && (phoneOpts.length > 0 || emailOpts.length > 0) && (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[13px] space-y-2">
                <p className="font-medium">What the merged record should be reachable on</p>
                {phoneOpts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="w-14 shrink-0 text-muted-foreground">Phone</span>
                    {phoneOpts.map((o) => (
                      <label key={o.value} className="inline-flex items-center gap-1.5">
                        <input type="radio" name="mphone" checked={phone === o.value} onChange={() => setPhone(o.value)} />
                        <span className="font-mono">{o.value}</span>
                        <span className="text-[11px] text-muted-foreground">({o.from === "invoices" ? "from invoices" : "on the record"})</span>
                      </label>
                    ))}
                    <label className="inline-flex items-center gap-1.5">
                      <input type="radio" name="mphone" checked={phone === ""} onChange={() => setPhone("")} />
                      <span className="text-muted-foreground">leave blank</span>
                    </label>
                  </div>
                )}
                {emailOpts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="w-14 shrink-0 text-muted-foreground">Email</span>
                    {emailOpts.map((o) => (
                      <label key={o.value} className="inline-flex items-center gap-1.5">
                        <input type="radio" name="memail" checked={email === o.value} onChange={() => setEmail(o.value)} />
                        <span>{o.value}</span>
                        <span className="text-[11px] text-muted-foreground">({o.from === "invoices" ? "from invoices" : "on the record"})</span>
                      </label>
                    ))}
                    <label className="inline-flex items-center gap-1.5">
                      <input type="radio" name="memail" checked={email === ""} onChange={() => setEmail("")} />
                      <span className="text-muted-foreground">leave blank</span>
                    </label>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Whatever isn't chosen is still kept on the survivor as an alternative contact — nothing is thrown away.
                </p>
              </div>
            )}

            {crossesAccounts && chosen.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-[13px]">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
                  <div>
                    <p>
                      These carry <b>different GA4 account numbers</b> ({accts.join(" ≠ ")}). Usually that
                      means genuinely different accounts, so the merge refuses unless you confirm.
                      One business entered several times is the exception — that's what this is for.
                    </p>
                    <label className="mt-2 flex items-center gap-2 font-medium">
                      <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                      I've checked these are the same customer
                    </label>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:justify-between">
              <div className="text-[12px] text-muted-foreground self-center">
                {chosen.length === 0 ? "Tick the records to fold in." : (
                  <span className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5" /> {plural(chosen.reduce((a, r) => a + r.vehicles, 0), "vehicle")}</span>
                    <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> {plural(chosen.reduce((a, r) => a + r.documents, 0), "invoice")}</span>
                    <span>move to {keep?.name}</span>
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button
                  disabled={!keep || chosen.length === 0 || merge.isPending || (crossesAccounts && !confirmed)}
                  onClick={() => keep && merge.mutate({ primaryId: keep.id, secondaryIds: chosen.map((r) => r.id), force: crossesAccounts, phone, email })}>
                  {merge.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <GitMerge className="w-4 h-4 mr-1.5" />}
                  Merge {chosen.length || ""} into {keep ? (keep.accountNumber || keep.name) : "…"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
