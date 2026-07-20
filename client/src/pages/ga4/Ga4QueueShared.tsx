import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Phone } from "lucide-react";

// Shared between Ga4Home (two stacked queue panels) and Ga4DocumentsQueue (one
// full-width panel per doc type) — the real GA4 desktop table/chrome pieces.

export const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");
export const money = (v: string | number | null) =>
  v == null ? "-" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const isToday = (d: string | Date | null) => { if (!d) return false; const x = new Date(d), n = new Date(); return x.toDateString() === n.toDateString(); };
export const soon = (label: string) => () => toast.message(`${label} isn't wired up in Classic view yet.`);

const tableColumns = [
  { label: "T", className: "col-type" },
  { label: "Doc No", className: "col-doc" },
  { label: "Date", className: "col-date" },
  { label: "Registration", className: "col-reg" },
  { label: "Make & Model", className: "col-model" },
  { label: "Customer", className: "col-customer" },
  { label: "Lab#", className: "col-lab" },
  { label: "Total", className: "col-total" },
  { label: "Status", className: "col-status" },
  { label: "", className: "col-phone" },
  { label: "", className: "col-open" },
];

export function BevelButton({ children, className = "", onClick, disabled }: { children: React.ReactNode; className?: string; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" className={`bevel-button ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

// Real GA4 desktop table, wired to live data (the reference shell it was ported
// from left every row blank — see index.css's "Reference-locked shell chrome").
export function DataTable({ rows, loading, onOpen }: { rows: any[]; loading: boolean; onOpen: (id: number) => void }) {
  return (
    <div className="data-table-wrap" role="region" aria-label="Documents">
      <table className="data-table">
        <thead>
          <tr>{tableColumns.map((c, i) => <th key={i} className={c.className}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={11} style={{ textAlign: "center", color: "#777" }}>Loading…</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={11} style={{ textAlign: "center", color: "#777" }}>Nothing in progress</td></tr>}
          {rows.map((d) => (
            <tr key={d.id} onClick={() => onOpen(d.id)}>
              <td className="col-type">{d.docType}</td>
              <td className="col-doc">{d.docNo || "-"}</td>
              <td className="col-date">{fmtDate(d.dateIssued || d.dateCreated || d.createdAt)}</td>
              <td className="col-reg">{d.registration || "—"}</td>
              <td className="col-model">{[d.make, d.model].filter(Boolean).join(" ") || "—"}</td>
              <td className="col-customer">{d.customerName || "—"}</td>
              <td className="col-lab">~</td>
              <td className="col-total">{money(d.totalGross)}</td>
              <td className="col-status"><span className="status-placeholder">~ <ChevronDown size={10} /></span></td>
              <td className="col-phone">{d.phone && <Phone size={12} className="phone-placeholder" style={{ display: "inline" }} />}</td>
              <td className="col-open"><button type="button" className="open-button" onClick={(e) => { e.stopPropagation(); onOpen(d.id); }}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UtilityRail() {
  const [notesTab, setNotesTab] = useState<"global" | "user">("global");
  const [notes, setNotes] = useState("");
  return (
    <aside className="utility-rail">
      <section className="rail-panel reminders-panel">
        <h2>Reminders</h2>
        <div className="rail-grid">
          {["Due", "Errors", "Failed", "Expired"].map((label) => (
            <div className="rail-row" key={label}><span>{label}</span><b>—</b></div>
          ))}
        </div>
      </section>

      <section className="rail-panel stock-panel">
        <h2>Stock Order Info</h2>
        <div className="rail-grid">
          {["Required Stock", "Orders to Process", "Returns to Process", "Due Delivery"].map((label) => (
            <div className="rail-row" key={label}><span>{label}</span><b>—</b></div>
          ))}
        </div>
      </section>

      <section className="rail-panel notes-panel">
        <div className="notes-tabs" role="tablist">
          <button type="button" className={notesTab === "global" ? "active" : ""} onClick={() => setNotesTab("global")}>Global Notes</button>
          <button type="button" className={notesTab === "user" ? "active" : ""} onClick={() => setNotesTab("user")}>User Notes</button>
        </div>
        <textarea
          aria-label={notesTab === "global" ? "Global Notes" : "User Notes"}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          spellCheck={false}
        />
        <div className="notes-footer">
          <BevelButton onClick={() => toast.message("Notes aren't wired up in Classic view yet.")}>Save Notes</BevelButton>
          <button type="button" className="refresh-notes" onClick={() => setNotes("")} aria-label="Clear notes">↻</button>
        </div>
      </section>
    </aside>
  );
}
