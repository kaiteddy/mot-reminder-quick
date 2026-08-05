/**
 * Turning on lock-screen notifications for this phone.
 *
 * iOS only allows web push once the app has been added to the Home Screen — in a Safari tab the
 * Notification API isn't even defined. That's why `reason` distinguishes "can't here" from
 * "blocked": the fix for the first is Share → Add to Home Screen, and the hook says so rather
 * than leaving a dead button.
 */
import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export type PushState =
  | "unsupported"       // browser has no push at all
  | "needs-install"     // iOS Safari tab — must be added to the Home Screen first
  | "denied"            // permission refused; only recoverable in device settings
  | "off"               // available, not yet enabled
  | "on";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

/** VAPID public keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  const { data: keyData } = trpc.push.publicKey.useQuery();
  const subscribe = trpc.push.subscribe.useMutation();
  const unsubscribe = trpc.push.unsubscribe.useMutation();

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
      setState(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") { setState("denied"); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    } catch { setState("off"); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** Must be called from a click — browsers reject a permission prompt without a user gesture. */
  const enable = useCallback(async () => {
    setBusy(true);
    try {
      if (!keyData?.publicKey) throw new Error("Push isn't configured on the server yet");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return false; }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource,
      });
      const json: any = sub.toJSON();
      await subscribe.mutateAsync({
        endpoint: sub.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        label: isIos() ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android phone" : "Desktop",
        userAgent: navigator.userAgent.slice(0, 300),
      });
      setState("on");
      return true;
    } finally { setBusy(false); }
  }, [keyData?.publicKey, subscribe]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribe.mutateAsync({ endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
    } finally { setBusy(false); }
  }, [unsubscribe]);

  return { state, busy, enable, disable, refresh, configured: !!keyData?.publicKey };
}
