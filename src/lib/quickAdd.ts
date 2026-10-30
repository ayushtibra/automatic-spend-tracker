import type { Category, Channel, PaymentMethod, PaymentMethodKind, TxnType } from '../types';
import { BANKS, cleanMerchant, MERCHANT_ALIASES } from './sms';

/**
 * Parses a short typed or spoken spend, e.g.
 *   "220 spent on groceries at zepto using hsbc credit card for ordering 5 items"
 *   "petrol 1.5k hdfc yesterday 8pm"
 * Works fully offline. Each field is pulled out independently and removed from the text,
 * so word order doesn't matter; whatever is left over becomes the merchant.
 */
export interface QuickAddResult {
  /** Paise. */
  amount?: number;
  type: TxnType;
  /** 'YYYY-MM-DDTHH:mm' when a date or time was mentioned. */
  occurredAt?: string;
  merchant?: string;
  categoryId?: string;
  paymentMethodId?: string;
  /** A card/account that was named but isn't in the user's list yet. */
  newMethod?: { bank?: string; kind: PaymentMethodKind; last4?: string };
  channel?: Channel;
  notes?: string;
}

export interface QuickAddContext {
  methods: PaymentMethod[];
  categories: Category[];
  /** Merchants used before, most frequent first. */
  merchants?: string[];
  now?: Date;
}

/** Everyday words for the default categories (matched as whole words). */
const CATEGORY_WORDS: Record<string, string[]> = {
  Groceries: ['groceries', 'grocery', 'vegetables', 'veggies', 'fruits', 'fruit', 'milk', 'kirana', 'ration', 'sabzi'],
  'Food & Dining': ['food', 'dining', 'dinner', 'lunch', 'breakfast', 'snacks', 'snack', 'coffee', 'tea', 'chai', 'restaurant', 'eating out', 'meal', 'pizza', 'biryani'],
  Shopping: ['shopping', 'clothes', 'clothing', 'shoes', 'electronics', 'gadget', 'shirt', 'jeans'],
  Transport: ['transport', 'cab', 'taxi', 'auto', 'rickshaw', 'metro', 'bus', 'parking', 'toll', 'fastag'],
  Fuel: ['fuel', 'petrol', 'diesel', 'cng'],
  Travel: ['travel', 'flight', 'flights', 'hotel', 'trip', 'train', 'vacation', 'holiday'],
  'Bills & Utilities': ['bill', 'bills', 'utilities', 'electricity', 'water bill', 'gas', 'recharge', 'internet', 'wifi', 'broadband', 'dth', 'phone bill', 'mobile bill'],
  Rent: ['rent'],
  Entertainment: ['entertainment', 'movie', 'movies', 'cinema', 'concert', 'game', 'games', 'outing'],
  Subscriptions: ['subscription', 'subscriptions', 'membership'],
  Health: ['health', 'medicine', 'medicines', 'doctor', 'pharmacy', 'hospital', 'medical', 'checkup', 'gym'],
  'Personal Care': ['personal care', 'salon', 'haircut', 'spa', 'grooming', 'parlour', 'parlor'],
  Education: ['education', 'books', 'book', 'course', 'fees', 'tuition', 'school', 'college'],
  Gifts: ['gift', 'gifts', 'present', 'donation'],
  Other: ['misc', 'miscellaneous'],
};

const UPI_APPS = /\b(upi|gpay|google pay|phonepe|phone pe|paytm|cred|bhim|scan(?:ned)? (?:and|&) pay|qr)\b/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** Words that join phrases; a phrase after one of these is a candidate merchant / note. */
const MARKERS = ['at', 'from', 'to', 'on', 'in', 'using', 'with', 'via', 'by', 'through', 'for'];
const FILLER = new Set([
  ...MARKERS,
  'spent', 'spend', 'paid', 'pay', 'paying', 'bought', 'buy', 'purchased', 'ordered', 'order', 'the', 'a', 'an', 'my', 'and', 'of',
  'rs', 'rupees', 'rupee', 'inr', 'bucks', 'i', 'it', 'was', 'got', 'did', 'just', 'some', 'me', 'card', 'today',
]);

const pad = (n: number) => String(n).padStart(2, '0');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
  const now = ctx.now ?? new Date();
  // Work on two aligned copies: lower-case for matching, original for names / notes.
  let orig = ` ${input.replace(/(\d),(?=\d)/g, '$1').replace(/\s+/g, ' ').trim()} `;
  let low = orig.toLowerCase();

  const textAt = (from: number, to: number) => orig.slice(from, to).replace(/\s+/g, ' ').trim();
  /** Find `re` in the lower-case text, blank it out in both copies; `text` is the original-case match. */
  const take = (re: RegExp): (RegExpExecArray & { text: string }) | null => {
    const m = re.exec(low);
    if (!m) return null;
    const text = textAt(m.index, m.index + m[0].length);
    const blank = ' '.repeat(m[0].length);
    low = low.slice(0, m.index) + blank + low.slice(m.index + m[0].length);
    orig = orig.slice(0, m.index) + blank + orig.slice(m.index + m[0].length);
    return Object.assign(m, { text });
  };

  const result: QuickAddResult = { type: 'debit' };

  // --- Refund / cashback (before "cash" is read as a payment method) ---
  if (take(/\b(refund(?:ed)?|cash ?back|got back|reversal|reversed|returned)\b/)) result.type = 'credit';

  // --- Date & time ---
  let day: Date | undefined;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) => new Date(startOfToday.getTime() - n * 86_400_000);
  let m: ReturnType<typeof take>;
  if (take(/\bday before yesterday\b/)) day = daysAgo(2);
  else if (take(/\byesterday\b/)) day = daysAgo(1);
  else if (take(/\btoday\b/)) day = startOfToday;
  else if ((m = take(/\b(\d{1,2}) days? ago\b/))) day = daysAgo(Number(m[1]));
  else if ((m = take(new RegExp(`\\b(?:on |last )?(${WEEKDAYS.join('|')})\\b`)))) {
    const diff = (now.getDay() - WEEKDAYS.indexOf(m[1]) + 7) % 7 || 7;
    day = daysAgo(diff);
  } else if ((m = take(/\b(?:on )?(\d{1,2})(?:st|nd|rd|th)? (?:of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?: (\d{4}))?\b/))) {
    day = pastDate(Number(m[1]), MONTHS.indexOf(m[2]), m[3] ? Number(m[3]) : undefined, now);
  } else if ((m = take(/\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?\b/))) {
    day = pastDate(Number(m[2]), MONTHS.indexOf(m[1]), m[3] ? Number(m[3]) : undefined, now);
  } else if ((m = take(/\b(?:on )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    day = pastDate(Number(m[1]), Number(m[2]) - 1, y, now);
  }

  let time: string | undefined;
  if ((m = take(/\b(?:at |around )?(\d{1,2})(?:[:.](\d{2}))? ?(am|pm|a\.m\.|p\.m\.)/))) {
    let h = Number(m[1]) % 12;
    if (m[3].startsWith('p')) h += 12;
    time = `${pad(h)}:${m[2] ?? '00'}`;
  } else if ((m = take(/\b(?:at |around )?([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    time = `${pad(Number(m[1]))}:${m[2]}`;
  } else if ((m = take(/\b(?:in the |this |last )?(morning|afternoon|evening|night|tonight)\b/))) {
    time = { morning: '09:00', afternoon: '14:00', evening: '19:00', night: '21:00', tonight: '21:00' }[m[1]];
  }
  if (day || time) {
    const d = day ?? startOfToday;
    const isToday = d.getTime() === startOfToday.getTime();
    const t = time ?? (isToday ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : '12:00');
    result.occurredAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${t}`;
  }

  // --- Card / account last 4 digits ---
  let last4: string | undefined;
  if ((m = take(/\b(?:ending(?: with| in)?|last (?:4|four)(?: digits)?|xx+|\*+|card no\.?|number)\s*(\d{4})\b/))) last4 = m[1];
  else {
    const known = ctx.methods.map((pm) => pm.last4).filter(Boolean) as string[];
    if (known.length && (m = take(new RegExp(`\\b(${known.join('|')})\\b(?=.*\\d)|(?<=\\d.*)\\b(${known.join('|')})\\b`)))) last4 = m[1] ?? m[2];
  }

  // --- Amount ---
  const unit = (u?: string) => (!u ? 1 : u === 'k' || u === 'thousand' ? 1000 : u.startsWith('la') ? 100_000 : u === 'hundred' ? 100 : 1);
  const NUM = String.raw`(\d+(?:\.\d{1,2})?)(?![\d.])`;
  const amountRes = [
    new RegExp(String.raw`(?:₹|\brs\.?|\binr)\s*${NUM}\s*(k|thousand|lakhs?|lacs?)?\b`),
    new RegExp(String.raw`\b${NUM}\s*(k|thousand|lakhs?|lacs?|hundred)?\s*(?:₹|rs\b\.?|inr\b|rupees?\b|bucks\b|\/-)`),
    new RegExp(
      String.raw`\b${NUM}\s*(k|thousand|lakhs?|lacs?|hundred)?\b(?!\s*(?:items?|pcs|pieces?|kgs?|kilos?|g|gm|grams?|ml|l|litres?|liters?|packets?|packs?|boxes?|bottles?|units?|nos|people|persons?|x)\b)`,
    ),
  ];
  for (const re of amountRes) {
    if ((m = take(re))) {
      result.amount = Math.round(Number(m[1]) * unit(m[2]) * 100);
      break;
    }
  }

  // --- Notes: "note: ..." anywhere ---
  if ((m = take(/\b(?:note|notes|remark|remarks)\s*[:-]?\s*(.+)$/))) result.notes = m.text.replace(/^\S+\s*[:-]?\s*/, '');

  // --- Payment method & mode ---
  if (take(UPI_APPS)) result.channel = 'upi';
  if (take(/\b(?:net ?banking|neft|imps|rtgs|bank transfer)\b/)) result.channel = 'netbanking';
  let kind: PaymentMethodKind | undefined;
  if (take(/\b(?:credit card|credit|cc)\b/)) kind = 'credit_card';
  else if (take(/\b(?:debit card|debit)\b/)) kind = 'debit_card';
  else if (take(/\b(?:savings account|bank account|account|a\/c|acct|savings)\b/)) kind = 'bank_account';
  else if (take(/\bwallet\b/)) kind = 'wallet';
  const saidCard = !!take(/\bcards?\b/);
  const saidCash = !!take(/\b(?:in |by |with )?cash\b/);

  // Bank: the user's own bank names first, then the known list.
  let bank: string | undefined;
  const ownBanks = [...new Set(ctx.methods.map((pm) => pm.bank).filter(Boolean) as string[])].sort((a, b) => b.length - a.length);
  for (const b of ownBanks) if (take(new RegExp(`\\b${esc(b.toLowerCase())}\\b(?: bank)?`))) { bank = b; break; }
  if (!bank) {
    for (const [re, name] of BANKS) {
      // "AU" is too common a sound to trust alone; require "AU bank/card/account/credit/debit".
      const source = name === 'AU' ? String.raw`\bau(?= (?:bank|card|account|a\/c|credit|debit)\b)` : re.source;
      if (take(new RegExp(`(?:${source})(?: bank)?`, 'i'))) {
        bank = name;
        break;
      }
    }
  }
  // Card nicknames ("regalia", "millennia", "amazon pay icici"...) from the user's own card names.
  let nicknameHit: PaymentMethod | undefined;
  for (const pm of ctx.methods) {
    const words = pm.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !FILLER.has(w) && !/^(credit|debit|card|bank|account)$/.test(w) && w !== pm.bank?.toLowerCase());
    for (const w of words) if (take(new RegExp(`\\b${esc(w)}\\b`))) nicknameHit = pm;
  }

  if (saidCash && !bank && !kind) {
    result.paymentMethodId = ctx.methods.find((pm) => pm.kind === 'cash' && !pm.archived)?.id;
    result.channel = 'cash';
  } else if (bank || kind || last4 || nicknameHit) {
    const score = (pm: PaymentMethod) =>
      (nicknameHit?.id === pm.id ? 6 : 0) +
      (last4 && pm.last4 === last4 ? 8 : 0) +
      (bank && pm.bank?.toLowerCase() === bank.toLowerCase() ? 4 : bank && pm.name.toLowerCase().includes(bank.toLowerCase()) ? 3 : 0) +
      (kind && pm.kind === kind ? 2 : 0) +
      (!kind && saidCard && (pm.kind === 'credit_card' || pm.kind === 'debit_card') ? 1 : 0) +
      // UPI normally debits a bank account (RuPay credit cards are the exception, so only a nudge).
      (!kind && !saidCard && result.channel === 'upi' && pm.kind === 'bank_account' ? 2 : 0) -
      (bank && pm.bank && pm.bank.toLowerCase() !== bank.toLowerCase() ? 5 : 0) -
      (last4 && pm.last4 && pm.last4 !== last4 ? 8 : 0) -
      (kind && pm.kind !== kind ? 1 : 0);
    const best = ctx.methods
      .filter((pm) => !pm.archived && pm.kind !== 'cash')
      .map((pm) => [pm, score(pm)] as const)
      .sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 3) result.paymentMethodId = best[0].id;
    else if (bank) result.newMethod = { bank, kind: kind ?? (result.channel === 'upi' ? 'bank_account' : 'credit_card'), last4 };
  }
  if (!result.channel) {
    if (saidCard || kind === 'credit_card' || kind === 'debit_card') result.channel = 'card';
    else if (saidCash) result.channel = 'cash';
  }

  // --- Merchants you've used before win over category words ("Chai Point" is not "chai") ---
  for (const name of [...(ctx.merchants ?? [])].filter((n) => n.length > 2).sort((a, b) => b.length - a.length)) {
    if (take(new RegExp(`\\b(?:at |from |to |on |in )?${esc(name.toLowerCase())}\\b`))) {
      result.merchant = name;
      break;
    }
  }

  // --- Category ---
  const catTerms: [Category, string][] = [];
  for (const c of ctx.categories.filter((c) => !c.archived)) {
    catTerms.push([c, c.name.toLowerCase()]);
    for (const w of CATEGORY_WORDS[c.name] ?? []) catTerms.push([c, w]);
  }
  catTerms.sort((a, b) => b[1].length - a[1].length);
  for (const [c, term] of catTerms) {
    if (take(new RegExp(`\\b${esc(term)}\\b`))) {
      result.categoryId = c.id;
      // Drop other words of the same category too ("electricity bill" -> both words).
      for (const [c2, t2] of catTerms) if (c2.id === c.id) while (take(new RegExp(`\\b${esc(t2)}\\b`)));
      break;
    }
  }

  const meaningful = (s: string) => s.split(' ').filter((w) => w && !FILLER.has(w.toLowerCase()) && !/^\d+$/.test(w));
  const knownMerchant = (s: string): string | undefined => {
    const lower = s.toLowerCase();
    const k = [...(ctx.merchants ?? [])].sort((a, b) => b.length - a.length).find((name) => new RegExp(`\\b${esc(name.toLowerCase())}\\b`).test(lower));
    return k ?? MERCHANT_ALIASES.find(([re]) => lower.split(' ').some((w) => w && re.test(w)))?.[1];
  };
  const stopAt = (markers: string[]) => `(?=\\s(?:${markers.join('|')})\\s|\\s*$)`;

  // --- "for <something>" that isn't a category: a known merchant ("for zepto order") or a note ---
  if ((m = take(new RegExp(`\\bfor\\s+([a-z0-9].*?)${stopAt(MARKERS.filter((x) => x !== 'for'))}`)))) {
    const phrase = m.text.replace(/^for\s+/i, '');
    const words = meaningful(phrase);
    const merchantInPhrase = words.length <= 3 ? knownMerchant(phrase) : undefined;
    if (merchantInPhrase) result.merchant = merchantInPhrase;
    else if (words.length && !result.notes) result.notes = phrase;
  }

  // --- Merchant: "at / from / to / on / in <name>", else a known merchant, else what's left ---
  for (const marker of result.merchant ? [] : ['at', 'from', 'to', 'on', 'in']) {
    const re = new RegExp(`\\b${marker}\\s+([a-z0-9][^]*?)${stopAt(MARKERS)}`);
    const hit = re.exec(low);
    if (!hit) continue;
    const words = meaningful(textAt(hit.index + marker.length, hit.index + hit[0].length));
    if (words.length) {
      result.merchant = cleanMerchant(words.join(' '));
      take(re);
      break;
    }
  }
  if (!result.merchant) {
    const left = meaningful(textAt(0, orig.length));
    result.merchant = knownMerchant(low) ?? (left.length && left.length <= 4 ? cleanMerchant(left.join(' ')) : undefined);
  }

  return result;
}

/** A day/month without a year means the most recent such date (never in the future). */
function pastDate(d: number, monthIndex: number, year: number | undefined, now: Date): Date | undefined {
  if (monthIndex < 0 || monthIndex > 11 || d < 1 || d > 31) return undefined;
  let date = new Date(year ?? now.getFullYear(), monthIndex, d);
  if (!year && date > now) date = new Date(now.getFullYear() - 1, monthIndex, d);
  return date;
}

/** Heuristic: is this a pasted bank alert (vs. a short typed / spoken note)? */
export function looksLikeBankSms(text: string): boolean {
  return /\b(?:a\/c|acct|card no|avl|available (?:bal|limit)|bal\b|not you|block|dispute|ref(?: no)?\b|xx\d{3,4}|x\d{4}|\*{2,}\d{4})/i.test(text) && text.length > 40;
}
