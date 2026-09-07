import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, MessageSquare, Hourglass } from "lucide-react";

const COMMON = [
  { name: "Gmail", host: "smtp.gmail.com", port: 587 },
  { name: "Outlook/Hotmail/Live", host: "smtp-mail.outlook.com", port: 587 },
  { name: "Yahoo", host: "smtp.mail.yahoo.com", port: 587 },
];

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: any; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="grid grid-cols-3 items-center gap-3">
      <label className="text-sm text-muted-foreground">{label}</label>
      <input className="col-span-2 border rounded px-2 py-1.5 text-sm outline-none focus:border-violet-500" type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export default function EmailSettings() {
  const { data } = trpc.email.getSettings.useQuery();
  const save = trpc.email.saveSettings.useMutation();
  const test = trpc.email.test.useMutation();
  const utils = trpc.useUtils();
  const [f, setF] = useState<any>({ secure: true, port: 587, authMethod: "LOGIN", timeout: 60 });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  useEffect(() => { if (data) setF((p: any) => ({ ...p, ...data, pass: "" })); }, [data]);

  const payload = () => ({ ...f, port: Number(f.port) || 587, timeout: Number(f.timeout) || 60 });
  async function onSave() {
    try { await save.mutateAsync(payload()); await utils.email.getSettings.invalidate(); toast.success("Email settings saved"); }
    catch (e: any) { toast.error(e.message); }
  }
  async function onTest() {
    try { await save.mutateAsync(payload()); await test.mutateAsync(); toast.success("SMTP connection OK ✓"); }
    catch (e: any) { toast.error("Connection failed: " + e.message); }
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Mail className="w-6 h-6" /> Email Settings</h1>
          <p className="text-muted-foreground mt-1">Connect directly to your email provider's SMTP server to send invoices &amp; estimates (same as GA4).</p>
        </div>
        <Card>
          <CardHeader><CardTitle>SMTP Email Server</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Email From Address" value={f.fromAddress} onChange={(v) => set("fromAddress", v)} placeholder="service@elimotors.co.uk" />
            <Field label="From Name" value={f.fromName} onChange={(v) => set("fromName", v)} placeholder="ELI Motors Limited" />
            <Field label="Send Copies To" value={f.copyTo} onChange={(v) => set("copyTo", v)} placeholder="Optional" />
            <div className="border-t my-1" />
            <Field label="Outgoing (SMTP) server" value={f.host} onChange={(v) => set("host", v)} placeholder="smtp.gmail.com" />
            <Field label="Email Username" value={f.user} onChange={(v) => set("user", v)} placeholder="service@elimotors.co.uk" />
            <Field label="Email Password" value={f.pass} onChange={(v) => set("pass", v)} type="password" placeholder={data?.hasPassword ? "•••• saved — leave blank to keep" : "App password"} />
            <div className="grid grid-cols-3 gap-3 items-center">
              <label className="text-sm text-muted-foreground">SSL / TLS</label>
              <div className="col-span-2 flex gap-2">
                <button type="button" onClick={() => set("secure", true)} className={`px-4 py-1 rounded text-sm ${f.secure ? "bg-violet-700 text-white" : "border"}`}>Yes</button>
                <button type="button" onClick={() => set("secure", false)} className={`px-4 py-1 rounded text-sm ${!f.secure ? "bg-violet-700 text-white" : "border"}`}>No</button>
              </div>
            </div>
            <Field label="SMTP Port" value={f.port} onChange={(v) => set("port", v)} type="number" placeholder="587" />
            <Field label="Auth Method" value={f.authMethod} onChange={(v) => set("authMethod", v)} placeholder="LOGIN" />
            <Field label="Timeout (secs)" value={f.timeout} onChange={(v) => set("timeout", v)} type="number" placeholder="60" />
            <div className="bg-blue-50 border border-blue-100 rounded p-3 text-xs text-slate-600 space-y-2">
              <p>Defaults: SSL <b>Yes</b>, Auth <b>LOGIN</b>, Port <b>587</b>. For <b>Gmail</b> you must use a 16-character <b>App Password</b> — not your normal mailbox password (Google blocks that for SMTP).</p>
              <p>
                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-violet-700 underline font-semibold">Create a Gmail App Password ↗</a>
                {" "}— requires 2-Step Verification turned on. Paste the 16-char code into the Password field above.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span>Quick-fill server:</span>
                {COMMON.map((c) => (
                  <button key={c.name} type="button" onClick={() => { set("host", c.host); set("port", c.port); set("secure", true); }}
                    className="border border-slate-300 bg-white rounded px-2 py-0.5 hover:bg-violet-50 hover:border-violet-400">{c.name}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={onSave} disabled={save.isPending}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Save</Button>
              <Button variant="outline" onClick={onTest} disabled={test.isPending || save.isPending}>{test.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Test Connection</Button>
            </div>
          </CardContent>
        </Card>

        <StaffAlertsCard />
        <UnansweredAlertsCard />
      </div>
    </DashboardLayout>
  );
}

/**
 * Two separate things that both happen to use a Twilio SMS number, kept visibly apart because
 * conflating them was confusing: the number is primarily how we reach CUSTOMERS when WhatsApp
 * can't, and only optionally how we nudge staff.
 */
function StaffAlertsCard() {
  const { data } = trpc.staffAlerts.get.useQuery();
  const save = trpc.staffAlerts.save.useMutation();
  const test = trpc.staffAlerts.test.useMutation();
  const utils = trpc.useUtils();
  const [f, setF] = useState({ enabled: false, phone: "", fromNumber: "", cooldownMinutes: 15 });

  useEffect(() => {
    if (data) setF({
      enabled: data.enabled, phone: data.phone,
      fromNumber: data.fromNumber, cooldownMinutes: data.cooldownMinutes,
    });
  }, [data]);

  const persist = (next: typeof f) => save.mutateAsync({ ...next, cooldownMinutes: Number(next.cooldownMinutes) || 0 });

  async function onSave() {
    try { await persist(f); await utils.staffAlerts.get.invalidate(); toast.success("Saved"); }
    catch (e: any) { toast.error(e.message); }
  }
  async function onTest() {
    try {
      await persist({ ...f, enabled: true });
      const r: any = await test.mutateAsync();
      if (r?.sent) toast.success("Test text sent — check the phone");
      else toast.error(`Not sent: ${r?.reason || "unknown"}`);
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" /> Text messages</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            WhatsApp can't always reach a customer — some don't use it, and it refuses a free-form
            reply more than 24 hours after their last message. When that happens the app sends a
            normal text instead, so your reply still gets there. This is the number it sends from.
          </p>
          <Field label="Send texts from" value={f.fromNumber} onChange={(v) => setF((p) => ({ ...p, fromNumber: String(v) }))} placeholder="+447488896449" />
        </div>

        <div className="border-t pt-3 space-y-3">
          <div className="grid grid-cols-3 gap-3 items-start">
            <label className="text-sm text-muted-foreground pt-1">Also text me</label>
            <div className="col-span-2">
              <div className="flex gap-2">
                <button type="button" onClick={() => setF((p) => ({ ...p, enabled: true }))}
                  className={`px-4 py-1 rounded text-sm ${f.enabled ? "bg-violet-700 text-white" : "border"}`}>On</button>
                <button type="button" onClick={() => setF((p) => ({ ...p, enabled: false }))}
                  className={`px-4 py-1 rounded text-sm ${!f.enabled ? "bg-violet-700 text-white" : "border"}`}>Off</button>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Off is usually right. The notification on your phone is what tells you a customer has
                messaged — tap it and you land in the conversation ready to reply. A text can't do that.
                Turn this on only if you want a belt-and-braces nudge as well.
              </p>
            </div>
          </div>
          {f.enabled && (
            <>
              <Field label="Text me on" value={f.phone} onChange={(v) => setF((p) => ({ ...p, phone: String(v) }))} placeholder="+447700900123" />
              <Field label="Quiet period (mins)" value={f.cooldownMinutes} onChange={(v) => setF((p) => ({ ...p, cooldownMinutes: Number(v) }))} type="number" placeholder="15" />
            </>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Button onClick={onSave} disabled={save.isPending}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Save</Button>
          {f.enabled && (
            <Button variant="outline" onClick={onTest} disabled={test.isPending || save.isPending || !f.phone}>
              {test.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Send test text
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const DAY_LABELS: Array<[number, string]> = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];

/**
 * Unanswered-message escalation. A customer reply that nobody answers is the thing that loses
 * bookings — the phone banner is missed, the thread is opened and thereby "read", and the
 * customer waits. This nags (push + text + email) after a working-hours wait, repeating until
 * someone replies in Conversations or presses "No reply needed" on the thread.
 */
function UnansweredAlertsCard() {
  const { data } = trpc.unansweredAlerts.get.useQuery();
  const { data: preview, refetch: refetchPreview } = trpc.unansweredAlerts.preview.useQuery();
  const save = trpc.unansweredAlerts.save.useMutation();
  const test = trpc.unansweredAlerts.test.useMutation();
  const runNow = trpc.unansweredAlerts.runNow.useMutation();
  const utils = trpc.useUtils();
  const [f, setF] = useState({
    enabled: true, afterMinutes: 30, repeatMinutes: 60, maxAlerts: 6,
    openTime: "08:00", closeTime: "18:00", days: [1, 2, 3, 4, 5, 6] as number[],
    phone: "", email: "", lookbackDays: 7, windowWarnMinutes: 120,
  });

  useEffect(() => { if (data) setF({ ...data }); }, [data]);

  const persist = (next: typeof f) => save.mutateAsync({
    ...next,
    afterMinutes: Number(next.afterMinutes) || 30,
    repeatMinutes: Number(next.repeatMinutes) || 60,
    maxAlerts: Number(next.maxAlerts) || 6,
    lookbackDays: Number(next.lookbackDays) || 7,
    windowWarnMinutes: Math.max(0, Number(next.windowWarnMinutes) || 0),
  });

  async function onSave() {
    try { await persist(f); await utils.unansweredAlerts.get.invalidate(); await refetchPreview(); toast.success("Saved"); }
    catch (e: any) { toast.error(e.message); }
  }
  async function onTest() {
    try {
      await persist(f);
      const r: any = await test.mutateAsync();
      const got = [r.push ? `push ×${r.push}` : null, r.sms ? "text" : null, r.email ? "email" : null].filter(Boolean).join(", ");
      if (got) toast.success(`Test alert sent by ${got}`);
      if (r.errors?.length) toast.error(r.errors.join(" · "));
      if (!got && !r.errors?.length) toast.error("Nothing to send to — add a phone or email, or install the app on a phone for push");
    } catch (e: any) { toast.error(e.message); }
  }
  async function onRunNow() {
    try {
      const r: any = await runNow.mutateAsync();
      await refetchPreview();
      toast.success(r.alerted ? `Alerted about ${r.alerted} thread${r.alerted === 1 ? "" : "s"}` : "Nothing due right now");
    } catch (e: any) { toast.error(e.message); }
  }
  const toggleDay = (d: number) => setF((p) => ({ ...p, days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d].sort() }));

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Hourglass className="w-5 h-5" /> Unanswered messages</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          If a customer messages and nobody has replied after the wait below, you get a nudge — a
          notification on the phone, a text and an email — and it repeats until someone answers in
          Conversations or presses <strong>No reply needed</strong> on the thread. The clock only
          runs during working hours.
        </p>

        <div className="grid grid-cols-3 gap-3 items-start">
          <label className="text-sm text-muted-foreground pt-1">Alerts</label>
          <div className="col-span-2 flex gap-2">
            <button type="button" onClick={() => setF((p) => ({ ...p, enabled: true }))}
              className={`px-4 py-1 rounded text-sm ${f.enabled ? "bg-violet-700 text-white" : "border"}`}>On</button>
            <button type="button" onClick={() => setF((p) => ({ ...p, enabled: false }))}
              className={`px-4 py-1 rounded text-sm ${!f.enabled ? "bg-violet-700 text-white" : "border"}`}>Off</button>
          </div>
        </div>

        <Field label="Alert after (mins)" value={f.afterMinutes} onChange={(v) => setF((p) => ({ ...p, afterMinutes: Number(v) }))} type="number" placeholder="30" />
        <Field label="Repeat every (mins)" value={f.repeatMinutes} onChange={(v) => setF((p) => ({ ...p, repeatMinutes: Number(v) }))} type="number" placeholder="60" />
        <Field label="Stop after (alerts)" value={f.maxAlerts} onChange={(v) => setF((p) => ({ ...p, maxAlerts: Number(v) }))} type="number" placeholder="6" />

        <div className="grid grid-cols-3 gap-3 items-start">
          <label className="text-sm text-muted-foreground pt-1">WhatsApp window warning (mins before)</label>
          <div className="col-span-2">
            <input className="w-full border rounded px-2 py-1.5 text-sm outline-none focus:border-violet-500" type="number" value={f.windowWarnMinutes ?? ""} onChange={(e) => setF((p) => ({ ...p, windowWarnMinutes: Number(e.target.value) }))} placeholder="120" />
            <p className="text-xs text-slate-500 mt-1.5">
              WhatsApp only accepts a free reply within 24 hours of the customer's last message; after
              that it goes by text. This warns before that window shuts, regardless of the repeat timer —
              and before close of business if the window would shut overnight. 0 turns it off.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 items-center">
          <label className="text-sm text-muted-foreground">Working hours</label>
          <div className="col-span-2 flex items-center gap-2 text-sm">
            <input type="time" className="border rounded px-2 py-1.5 text-sm outline-none focus:border-violet-500" value={f.openTime} onChange={(e) => setF((p) => ({ ...p, openTime: e.target.value }))} />
            <span className="text-slate-500">to</span>
            <input type="time" className="border rounded px-2 py-1.5 text-sm outline-none focus:border-violet-500" value={f.closeTime} onChange={(e) => setF((p) => ({ ...p, closeTime: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 items-center">
          <label className="text-sm text-muted-foreground">Working days</label>
          <div className="col-span-2 flex flex-wrap gap-1.5">
            {DAY_LABELS.map(([d, label]) => (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                className={`px-2.5 py-1 rounded text-xs ${f.days.includes(d) ? "bg-violet-700 text-white" : "border text-slate-600"}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="border-t pt-3 space-y-3">
          <Field label="Text me on" value={f.phone} onChange={(v) => setF((p) => ({ ...p, phone: String(v) }))} placeholder="+447700900123 (blank = no text)" />
          <Field label="Email me at" value={f.email} onChange={(v) => setF((p) => ({ ...p, email: String(v) }))} placeholder="you@elimotors.co.uk (blank = no email)" />
          <p className="text-xs text-slate-500">
            Texts go from the number under Text messages above. Emails use the SMTP settings on this
            page. The phone notification goes to every phone that has installed the app and allowed
            notifications — nothing to set up here.
          </p>
        </div>

        {preview && (
          <div className="border-t pt-3">
            <div className="text-sm font-medium text-slate-800 mb-1.5">
              Waiting for a reply right now: {preview.waiting.length === 0 ? "nobody" : preview.waiting.length}
            </div>
            {preview.waiting.length > 0 && (
              <ul className="text-xs text-slate-600 space-y-1">
                {preview.waiting.map((w) => (
                  <li key={w.customerId} className="flex items-center gap-2">
                    <a className="text-violet-700 hover:underline" href={`/conversations?customer=${w.customerId}`}>
                      {w.customerName}{w.registration ? ` (${w.registration})` : ""}
                    </a>
                    <span>— waiting {w.waitingMinutes < 60 ? `${w.waitingMinutes}m` : `${Math.floor(w.waitingMinutes / 60)}h`} of working time</span>
                    <span className={w.windowMinutesLeft > 0 ? "text-amber-700" : "text-red-700"}>
                      · {w.windowMinutesLeft > 0 ? `WhatsApp closes in ${w.windowMinutesLeft < 60 ? `${w.windowMinutesLeft}m` : `${Math.floor(w.windowMinutesLeft / 60)}h`}` : "WhatsApp closed"}
                    </span>
                    <span className={w.alertNow ? "text-amber-700 font-medium" : "text-slate-400"}>· {w.alertNow ? "alert due" : w.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={onSave} disabled={save.isPending}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Save</Button>
          <Button variant="outline" onClick={onTest} disabled={test.isPending || save.isPending}>
            {test.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Send test alert
          </Button>
          <Button variant="outline" onClick={onRunNow} disabled={runNow.isPending || !f.enabled} title="Run the check now instead of waiting for the next scheduled pass">
            {runNow.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Check now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
