import { useEffect, useState } from "react";

// A small persistent list of "open" documents so staff can keep several on the go
// (like browser tabs) and jump between them — each shows its doc number + registration.
export type OpenDoc = { id: number; docNo?: string; reg?: string; type?: string };
const KEY = "eli.openDocs";
const MAX = 12;

export function readOpenDocs(): OpenDoc[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(docs: OpenDoc[]) {
  localStorage.setItem(KEY, JSON.stringify(docs.slice(0, MAX)));
  window.dispatchEvent(new Event("eli-opendocs"));
}
export function upsertOpenDoc(d: OpenDoc) {
  if (!d.id) return;
  const list = readOpenDocs();
  const i = list.findIndex((x) => x.id === d.id);
  if (i >= 0) list[i] = { ...list[i], ...d };       // update in place (keep tab order)
  else list.push(d);
  write(list);
}
export function removeOpenDoc(id: number) {
  write(readOpenDocs().filter((x) => x.id !== id));
}

export function useOpenDocs(): OpenDoc[] {
  const [docs, setDocs] = useState<OpenDoc[]>(readOpenDocs);
  useEffect(() => {
    const h = () => setDocs(readOpenDocs());
    window.addEventListener("eli-opendocs", h);
    window.addEventListener("storage", h); // sync across browser tabs
    return () => { window.removeEventListener("eli-opendocs", h); window.removeEventListener("storage", h); };
  }, []);
  return docs;
}
