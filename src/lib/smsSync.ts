import { db, getMeta, setMeta } from '../db';
import { isNative, SmsInbox, type NativeSms } from '../native/smsInbox';
import { parseSms } from './sms';

const PAGE = 500;
const DAY = 86_400_000;

/** FNV-1a: short stable id for an SMS so live + inbox-scan copies collapse into one. */
export function smsId(sender: string, body: string): string {
  let h = 0x811c9dc5;
  const s = `${sender.replace(/^[A-Z]{2}-/, '')}\n${body.trim()}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `sms-${(h >>> 0).toString(36)}-${s.length}`;
}

/** Store parseable bank transaction SMS as pending inbox items. Returns how many were new. */
export async function ingestSms(messages: NativeSms[]): Promise<number> {
  let added = 0;
  await db.transaction('rw', db.inbox, db.transactions, async () => {
    for (const m of messages) {
      if (!parseSms(m.body, new Date(m.date))) continue;
      const id = smsId(m.address, m.body);
      if (await db.inbox.get(id)) continue;
      // Already logged by pasting / sharing the same SMS.
      const body = m.body.trim();
      if (await db.transactions.filter((t) => !t.deletedAt && t.sourceRef === body).first()) continue;
      await db.inbox.add({ id, sender: m.address, body: m.body, receivedAt: m.date, status: 'pending', createdAt: new Date().toISOString() });
      added++;
    }
  });
  return added;
}

export async function isSmsCaptureEnabled(): Promise<boolean> {
  return isNative && (await getMeta<boolean>('smsEnabled')) === true;
}

/** Ask for SMS (+ notification) permission and start capturing from `daysBack` days ago (0 = today). */
export async function enableSmsCapture(daysBack: number): Promise<{ granted: boolean; added: number }> {
  const perms = await SmsInbox.requestPermissions({ permissions: ['sms', 'notifications'] });
  if (perms.sms !== 'granted') return { granted: false, added: 0 };
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  await setMeta('smsSyncedUntil', startOfToday - daysBack * DAY);
  await setMeta('smsEnabled', true);
  return { granted: true, added: await syncSms() };
}

export async function disableSmsCapture() {
  await setMeta('smsEnabled', false);
}

let running: Promise<number> | null = null;

/** Pull new bank SMS from the phone's inbox since the last sync. Safe to call often. */
export function syncSms(): Promise<number> {
  running ??= (async () => {
    try {
      if (!(await isSmsCaptureEnabled())) return 0;
      if ((await SmsInbox.checkPermissions()).sms !== 'granted') return 0;
      let since = (await getMeta<number>('smsSyncedUntil')) ?? Date.now();
      let added = 0;
      for (;;) {
        const { messages } = await SmsInbox.readMessages({ since, limit: PAGE });
        if (messages.length === 0) break;
        added += await ingestSms(messages);
        since = messages[messages.length - 1].date;
        await setMeta('smsSyncedUntil', since);
        await setMeta('smsLastCheckedAt', Date.now());
        if (messages.length < PAGE) break;
      }
      await setMeta('smsLastCheckedAt', Date.now());
      return added;
    } finally {
      running = null;
    }
  })();
  return running;
}
