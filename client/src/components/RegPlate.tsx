import { useClassicBase } from "@/lib/classicNav";

// vehicles.registration is stored solid (no space); GA4's own fields are space-formatted
// (see memory: reg-format-split-matching). Insert the space back in for GA4 Classic so it
// reads exactly like the desktop app regardless of which table the reg came from.
export function ga4Spaced(reg: string): string {
  const s = reg.toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(s)) return `${s.slice(0, 4)} ${s.slice(4)}`; // current format AA99 AAA
  return reg.toUpperCase();
}

// A UK number-plate badge: blue "UK" band + yellow plate with bold black lettering.
// In GA4 Classic, real GA4 shows registrations as plain space-formatted text (no plate
// graphic) in every list/field, so this renders plain text there instead of the badge.
export function RegPlate({ reg, size = "sm" }: { reg?: string | null; size?: "sm" | "xs" }) {
  const base = useClassicBase();
  if (!reg) return null;
  if (base) return <span className="font-normal tracking-wide">{ga4Spaced(reg)}</span>;
  const plate = size === "xs" ? "text-[11px] px-1.5 py-[1px]" : "text-[13px] px-2 py-0.5";
  const band = size === "xs" ? "text-[7px] px-[3px]" : "text-[8px] px-1";
  return (
    <span className="inline-flex items-stretch rounded-[4px] overflow-hidden border border-black/70 leading-none align-middle select-none shadow-sm font-mono">
      <span className={`bg-[#0b3aa3] text-white font-bold flex items-center justify-center ${band}`}>UK</span>
      <span className={`bg-[#fcd116] text-black font-extrabold tracking-[0.08em] uppercase flex items-center ${plate}`}>
        {String(reg).toUpperCase()}
      </span>
    </span>
  );
}
