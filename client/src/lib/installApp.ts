/**
 * Workshop Mode as its own home-screen app.
 *
 * A phone set up for the workshop should open straight onto Workshop Mode. "Add to Home Screen"
 * doesn't take the icon's start page from the page you were on, though: iOS and Android both take
 * it from the web app manifest, and the office manifest starts on Conversations, which a staff
 * login can't even open. So workshop screens give the browser workshop.webmanifest instead.
 *
 * index.html leaves the manifest link without an href and main.tsx fills it in before the first
 * render, so a phone arriving from the setup QR code is never handed the office app, however early
 * it reads the manifest. App.tsx keeps it in step as you move between screens.
 */
import { useSyncExternalStore } from "react";

const OFFICE_APP = { manifest: "/manifest.webmanifest", title: "ELI Motors", themeColor: "#c8102e" };
const WORKSHOP_APP = { manifest: "/workshop.webmanifest", title: "ELI Workshop", themeColor: "#0f172a" };

const isWorkshopPath = (path: string) => path === "/workshop" || path.startsWith("/workshop/");

/** Running from the home screen rather than in a browser tab (iOS reports it its own way). */
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

/** Give the page the home-screen app that `url` (a path, plus its query if any) belongs to. */
export function syncAppManifest(url: string) {
  const [path, query = ""] = url.split("?");
  // Signing in is a step of setting a phone up, so /login?next=/workshop is still the workshop app.
  const destination = path === "/login" ? (new URLSearchParams(query).get("next") ?? "").split("?")[0] : path;
  const app = isWorkshopPath(destination) ? WORKSHOP_APP : OFFICE_APP;

  const link = document.head.querySelector('link[rel="manifest"]');
  if (link && link.getAttribute("href") !== app.manifest) {
    link.setAttribute("href", app.manifest);
    // A prompt Chrome raised for the other manifest would install the other app.
    setInstallState({ event: null });
  }
  document.head.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", app.title);
  document.head.querySelector('meta[name="theme-color"]')?.setAttribute("content", app.themeColor);
}

/** Chrome's install prompt (Android, and desktop Chrome and Edge). Safari has no equivalent. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

type InstallState = { event: BeforeInstallPromptEvent | null; installed: boolean };
let installState: InstallState = { event: null, installed: false };
const listeners = new Set<() => void>();

function setInstallState(change: Partial<InstallState>) {
  installState = { ...installState, ...change };
  listeners.forEach((notify) => notify());
}

/**
 * Chrome fires beforeinstallprompt once, soon after the page loads: usually before the workshop
 * page's code has arrived and its login check has passed. Catch it at startup and keep it for the page.
 */
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    // The workshop page has its own Install button; Chrome's banner on top of it would be a second one.
    if (isWorkshopPath(window.location.pathname)) event.preventDefault();
    setInstallState({ event: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => setInstallState({ event: null, installed: true }));
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

export function useInstallPrompt() {
  const { event, installed } = useSyncExternalStore(subscribe, () => installState);
  const install = async () => {
    if (!event) return;
    setInstallState({ event: null }); // each prompt can only be shown once
    try {
      await event.prompt();
    } catch {
      /* the step-by-step instructions take over */
    }
  };
  return { canInstall: event !== null, installed, install };
}
