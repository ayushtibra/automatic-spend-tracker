const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Format paise as ₹1,23,456.78 (drops .00 for whole rupees). */
export function formatINR(paise: number): string {
  return paise % 100 === 0 ? inrWhole.format(paise / 100) : inr.format(paise / 100);
}

/** Parse user input like "1,234.5" or "₹ 250" into paise. Returns null when invalid. */
export function parseToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Paise to an editable string, e.g. 12350 -> "123.5". */
export function paiseToInput(paise: number): string {
  return String(paise / 100);
}
