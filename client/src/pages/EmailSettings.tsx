import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Loader2 } from "lucide-react";

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
      </div>
    </DashboardLayout>
  );
}
