/**
 * Web push — raises a banner on any phone that installed the app and allowed notifications.
 *
 * The VAPID keypair lives in appSettings rather than env vars so it can be rotated without a
 * redeploy; the public half is handed to the browser when it subscribes.
 */
import webpush from "web-push";

type Vapid = { publicKey: string; privateKey: string; subject?: string };

let configured: string | null = null; // public key we last configured web-push with

async function loadVapid(): Promise<Vapid | null> {
  const { getAppSetting } = await import("../db");
  const v = (await getAppSetting("push_vapid")) as Vapid | null;
  if (!v?.publicKey || !v?.privateKey) return null;
  if (configured !== v.publicKey) {
    webpush.setVapidDetails(v.subject || "mailto:adam@elimotors.co.uk", v.publicKey, v.privateKey);
    configured = v.publicKey;
  }
  return v;
}

export async function getPushPublicKey(): Promise<string | null> {
  return (await loadVapid())?.publicKey ?? null;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Path to open when the banner is tapped. */
  url?: string;
  /** Same tag replaces an earlier banner instead of stacking another one up. */
  tag?: string;
};

/**
 * Push to every subscribed device. Never throws — a notification failure must not take down the
 * webhook that triggered it. Subscriptions the push service reports as gone (404/410) are
 * deleted, since they can never succeed again.
 */
export async function pushToAll(payload: PushPayload): Promise<{ sent: number; pruned: number; failed: number }> {
  const result = { sent: 0, pruned: 0, failed: 0 };
  try {
    const vapid = await loadVapid();
    if (!vapid) return result;

    const { getDb } = await import("../db");
    const { pushSubscriptions } = await import("../../drizzle/schema");
    const { eq, inArray } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return result;

    const subs = await db.select().from(pushSubscriptions);
    if (!subs.length) return result;

    const body = JSON.stringify(payload);
    const dead: number[] = [];

    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        result.sent++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        else { result.failed++; console.error(`[Push] ${code ?? "?"} for sub ${s.id}: ${e?.message}`); }
      }
    }));

    if (dead.length) {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
      result.pruned = dead.length;
    }
    if (result.sent) {
      await db.update(pushSubscriptions).set({ lastNotifiedAt: new Date() })
        .where(inArray(pushSubscriptions.id, subs.filter((s: any) => !dead.includes(s.id)).map((s: any) => s.id)));
    }
    console.log(`[Push] sent=${result.sent} pruned=${result.pruned} failed=${result.failed}`);
  } catch (e: any) {
    console.error("[Push] failed:", e?.message);
  }
  return result;
}
