import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Round money to 2dp using decimal round-half-up — matches GA4's VAT/total rounding.
 * Plain `.toFixed(2)` / `Math.round(n*100)/100` round a half-penny DOWN whenever the float
 * sits just under the boundary (e.g. 7 × £5.975 = 41.82499… → "41.82" instead of £41.83),
 * which under-charges VAT by a penny and drifts totals away from GA4. The +1e-6 nudge (in
 * pence-space, far below any real value gap) absorbs that float error; sign-aware for credits.
 */
export function round2(n: number): number {
  return (n < 0 ? -1 : 1) * Math.round(Math.abs(n) * 100 + 1e-6) / 100;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}
