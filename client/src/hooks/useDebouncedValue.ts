import { useEffect, useState } from "react";

/**
 * The value, but only after it has stopped changing for `delay` ms.
 *
 * For lookups keyed on something being typed — a registration above all. Wiring a query straight
 * to the input fires it on every keystroke, so "LT68DJZ" asks DVLA about L, LT, LT6, LT68… and
 * every partial plate comes back as a failure. The typist sees errors for a car they are still
 * halfway through entering, and the slower they type the more of them they get.
 *
 * The input itself stays uncontrolled by this — keep binding it to the raw state so typing feels
 * instant — and only the query reads the debounced value.
 */
export function useDebouncedValue<T>(value: T, delay = 500): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** A UK plate is 7 characters unspaced; below that it is still being typed, not wrong. */
export function looksLikeCompleteReg(reg: string | null | undefined): boolean {
  return String(reg ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").length >= 6;
}
