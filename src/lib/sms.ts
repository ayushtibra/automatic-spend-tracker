import type { Channel, PaymentMethodKind, TxnType } from '../types';
import { parseToPaise } from './money';

/**
 * Bank transaction alert parser (SMS, and plain-text bodies of alert emails).
 *
 * Deliberately generic instead of one regex per bank template: banks change wording often,
 * so we pull out each field with independent heuristics and let the user confirm.
 */
export interface ParsedSms {
  type: TxnType;
  /** Paise. */
  amount: number;
  bank?: string;
  /** Last 4 digits of the card / account that was charged. */
  last4?: string;
  /** Best guess of the instrument kind, used when offering to create a missing card/account. */
  accountKind?: PaymentMethodKind;
  merchant?: string;
  /** 'YYYY-MM-DDTHH:mm' when a date was found in the text. */
  occurredAt?: string;
  channel?: Channel;
  /** UPI / RTGS / NEFT reference number. */
  ref?: string;
  /** RTGS/NEFT/IMPS or similar: probably a transfer rather than a spend. */
  likelyTransfer: boolean;
}

export const BANKS: [RegExp, string][] = [
  [/\bICICI\b/i, 'ICICI'],
  [/\bHDFC\b/i, 'HDFC'],
  [/\bAxis\b/i, 'Axis'],
  [/\bHSBC\b/i, 'HSBC'],
  [/\bAU\b(?: (?:Small Finance )?Bank| A\/c)/i, 'AU'],
  [/\bSBI\b|State Bank/i, 'SBI'],
  [/\bKotak\b/i, 'Kotak'],
  [/\bIDFC\b/i, 'IDFC First'],
  [/\bYes Bank\b/i, 'Yes Bank'],
  [/\bIndusInd\b/i, 'IndusInd'],
  [/\bRBL\b/i, 'RBL'],
  [/\bFederal Bank\b/i, 'Federal'],
  [/\bBank of Baroda\b|\bBOB\b/i, 'Bank of Baroda'],
  [/\bPNB\b|Punjab National/i, 'PNB'],
  [/\bCanara\b/i, 'Canara'],
  [/\bAmex\b|American Express/i, 'Amex'],
  [/\bOneCard\b/i, 'OneCard'],
  [/\bStandard Chartered\b|\bSCB\b/i, 'Standard Chartered'],
];

/** Not a completed transaction: OTPs, reminders, declines, card bill payments received. */
const NOT_A_TXN = /\bOTP\b|one time password|will be debited|is due\b|due date|declined|\bfailed\b|payment of .{0,40}received|thank you for (?:your )?payment|requested money|collect request/i;
const DEBIT = /\bdebited\b|\bspent\b|\bdr\.?\b|\btxn\b|\bused (?:at|for)\b|\bpaid\b|\bsent\b|\bwithdrawn\b|\bpurchase\b|\bcharged\b/i;
const CREDIT = /\bcredited\b|\brefund(?:ed)?\b|\brevers(?:al|ed)\b|\bcashback\b/i;
/** Amounts preceded by these words are balances / limits, never the transaction amount. */
const NON_TXN_AMOUNT = /(?:avl|avail|available|bal|balance|limit|due|outstanding|min(?:imum)?)\b[^0-9]{0,12}$/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Merchant names that alerts commonly truncate or encode. */
export const MERCHANT_ALIASES: [RegExp, string][] = [
  [/^bookmy/i, 'BookMyShow'],
  [/^flipkart ?gr/i, 'Flipkart Grocery'],
  [/^flipkart/i, 'Flipkart'],
  [/^amazon|^amzn/i, 'Amazon'],
  [/^swiggy/i, 'Swiggy'],
  [/^zomato/i, 'Zomato'],
  [/^blinkit|^grofers/i, 'Blinkit'],
  [/^zepto/i, 'Zepto'],
  [/^bigbasket|^bbnow/i, 'BigBasket'],
  [/^myntra/i, 'Myntra'],
  [/^rapido/i, 'Rapido'],
  [/^uber/i, 'Uber'],
  [/^ola(?:cabs)?\b/i, 'Ola'],
  [/^irctc/i, 'IRCTC'],
  [/^makemytrip|^mmt\b/i, 'MakeMyTrip'],
  [/^netflix/i, 'Netflix'],
  [/^spotify/i, 'Spotify'],
];

const pad = (n: number) => String(n).padStart(2, '0');

export function parseSms(raw: string, receivedAt: Date = new Date()): ParsedSms | null {
  const text = raw.replace(/\r/g, '').trim();
  if (!text || NOT_A_TXN.test(text)) return null;

  const isDebit = DEBIT.test(text);
  const isCredit = CREDIT.test(text);
  if (!isDebit && !isCredit) return null;

  const amount = findAmount(text);
  if (!amount) return null;

  const channel = findChannel(text);
  return {
    type: isDebit ? 'debit' : 'credit',
    amount,
    bank: BANKS.find(([re]) => re.test(text))?.[1],
    last4: findLast4(text),
    accountKind: findKind(text),
    merchant: findMerchant(text),
    occurredAt: findDateTime(text, receivedAt),
    channel,
    ref: text.match(/UPI[-\s:/]*(?:Ref\w*[^\d]*)?(\d{12})\b/i)?.[1] ?? text.match(/\b(?:RTGS|NEFT|IMPS)\b[^-\n]*-\s*([A-Z0-9]{10,})/i)?.[1],
    likelyTransfer: channel === 'netbanking' || /\bto self\b|\bown account\b/i.test(text),
  };
}

function findAmount(text: string): number | null {
  for (const m of text.matchAll(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi)) {
    if (NON_TXN_AMOUNT.test(text.slice(Math.max(0, m.index! - 25), m.index))) continue;
    const paise = parseToPaise(m[1]);
    if (paise) return paise;
  }
  return null;
}

function findLast4(text: string): string | undefined {
  return (
    text.match(/\b(?:card|a\/c|acct|account|ac)\b[^0-9\n]{0,12}?[xX*]*(\d{4})\b/i)?.[1] ??
    text.match(/[xX*]{2,}(\d{4})\b/)?.[1]
  );
}

function findKind(text: string): PaymentMethodKind | undefined {
  if (/credit card|\bCC\b|avl\.? limit|available limit|credit limit/i.test(text)) return 'credit_card';
  if (/debit card/i.test(text)) return 'debit_card';
  if (/\b(?:a\/c|acct|account)\b/i.test(text)) return 'bank_account';
  if (/\bcard\b/i.test(text)) return 'credit_card';
  if (/wallet/i.test(text)) return 'wallet';
  return undefined;
}

function findChannel(text: string): Channel | undefined {
  if (/\bUPI\b|@[a-z]+\b/i.test(text)) return 'upi';
  if (/\b(?:RTGS|NEFT|IMPS)\b|net ?banking/i.test(text)) return 'netbanking';
  if (/\bATM\b|cash withdrawal/i.test(text)) return 'cash';
  if (/\bcard\b/i.test(text)) return 'card';
  return undefined;
}

function findMerchant(text: string): string | undefined {
  const candidates = [
    // "...for UPI-654530294458-Bookmysh."
    text.match(/UPI[-/]\d{6,}[-/]([^.\n]+?)(?:\.\s|\.?$|\n)/im)?.[1],
    // "RTGS DR-AUBLR6202...-ayush un" -> beneficiary
    text.match(/\b(?:RTGS|NEFT|IMPS)\b.*-\s*([A-Za-z][A-Za-z .&]*?)\s*$/im)?.[1],
    // "at WHITE VENTURES ONLINE PR for INR", "At rapido522347.rzp@rxaxis by UPI", "to swiggy@icici on"
    text.match(/\b(?:at|to|towards|VPA)\s+([A-Za-z][^\n]*?)(?=\s+(?:on|for|by|via|ref|avl|txn|info|using|from)\b|[.;,](?:\s|$)|\n|$)/i)?.[1],
    // Axis-style alert flattened to one line: "...13:29:25 IST FLIPKART GR Avl Limit..."
    text.match(/\d{1,2}:\d{2}(?::\d{2})?(?:\s*IST)?\s+([A-Za-z][A-Za-z0-9 &'.*-]*?)\s+(?=Avl|Available|Bal\b|Not you|Limit)/i)?.[1],
    // Multi-line alerts where the merchant sits alone on a line (Axis).
    text
      .split('\n')
      .map((l) => l.trim())
      .find(
        (l) =>
          /^[A-Za-z][A-Za-z0-9 &'.*-]{1,40}$/.test(l) &&
          !/\d{3,}/.test(l) &&
          !/\b(?:spent|debited|credited|card|bank|a\/c|inr|rs|avl|bal|block|call|not you|txn|dear|customer|fraud)\b/i.test(l),
      ),
  ];
  const found = candidates.find((c) => c && c.trim().length > 1);
  return found ? cleanMerchant(found) : undefined;
}

export function cleanMerchant(raw: string): string {
  let name = raw.trim();
  // UPI VPA like "rapido522347.rzp@rxaxis" -> "rapido"
  if (name.includes('@')) {
    const handle = name.split('@')[0].split('.')[0].replace(/\d+$/, '');
    if (handle.length > 1) name = handle;
  }
  name = name.replace(/[*_]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-:]+|[\s\-:.,]+$/g, '');
  const alias = MERCHANT_ALIASES.find(([re]) => re.test(name));
  if (alias) return alias[1];
  // Shouting or all-lowercase -> Title Case.
  if (name === name.toUpperCase() || name === name.toLowerCase()) {
    name = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return name;
}

function findDateTime(text: string, receivedAt: Date): string | undefined {
  let y: number | undefined, m: number | undefined, d: number | undefined;

  const named = text.match(/\b(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ,]+(\d{2,4})\b/);
  const numeric = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  const noYear = text.match(/\bon (\d{1,2})[-/](\d{1,2})\b(?![-/]\d)/i);

  if (named && MONTHS.includes(named[2].toLowerCase())) {
    [d, m, y] = [Number(named[1]), MONTHS.indexOf(named[2].toLowerCase()) + 1, Number(named[3])];
  } else if (numeric) {
    [d, m, y] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
  } else if (noYear) {
    [d, m] = [Number(noYear[1]), Number(noYear[2])];
    y = receivedAt.getFullYear();
    // A day-month later than "now" must be from last year (e.g. 31-12 received on 01-01).
    if (new Date(y, m - 1, d) > receivedAt) y -= 1;
  }
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  if (y < 100) y += 2000;

  const date = `${y}-${pad(m)}-${pad(d)}`;
  const t = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
  if (t) {
    let h = Number(t[1]);
    if (t[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (t[3]?.toLowerCase() === 'am' && h === 12) h = 0;
    return `${date}T${pad(h)}:${t[2]}`;
  }
  // No time in the SMS: use the time it was received if it's the same day, else midday.
  const rec = `${receivedAt.getFullYear()}-${pad(receivedAt.getMonth() + 1)}-${pad(receivedAt.getDate())}`;
  return `${date}T${rec === date ? `${pad(receivedAt.getHours())}:${pad(receivedAt.getMinutes())}` : '12:00'}`;
}
