// A UK number-plate badge: blue "UK" band + yellow plate with bold black lettering.
export function RegPlate({ reg, size = "sm" }: { reg?: string | null; size?: "sm" | "xs" }) {
  if (!reg) return null;
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
