import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Copy, MoreVertical, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isStandalone, useInstallPrompt } from "@/lib/installApp";
import { isApplePhone, isHandheld } from "@/lib/printDocument";

/**
 * Getting Workshop Mode onto a phone, shown at the top of Workshop Mode.
 *
 * On a computer it's a QR code: scan it, sign in, and the phone opens this same page. On the phone
 * it's the steps to add Workshop Mode to the home screen, where it opens full screen like an app,
 * and straight onto Workshop Mode because workshop screens hand out their own manifest (see
 * lib/installApp). Once it's running from the home screen there's nothing left to set up.
 */
export function WorkshopPhoneSetup() {
  if (isStandalone()) return null;
  return isHandheld() ? <AddToHomeScreen /> : <OpenOnPhone />;
}

const HIDE_QR_KEY = "workshop.phoneSetup.hidden";
const DISMISS_STEPS_KEY = "workshop.addToHomeScreen.dismissed";

// Remembered per browser; where storage is blocked it simply shows again next time.
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* not remembered */
  }
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
        {n}
      </span>
      <span className="pt-0.5 leading-snug">{children}</span>
    </li>
  );
}

/** On a computer: a QR code that opens Workshop Mode on the phone. */
function OpenOnPhone() {
  const [hidden, setHidden] = useState(() => readFlag(HIDE_QR_KEY));
  const [qrFailed, setQrFailed] = useState(false);
  // install=1 makes the phone show its home-screen steps, even if someone once closed them there.
  const url = `${window.location.origin}/workshop?install=1`;

  const rememberHidden = (next: boolean) => {
    setHidden(next);
    writeFlag(HIDE_QR_KEY, next);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  if (hidden) {
    return (
      <Button variant="outline" onClick={() => rememberHidden(false)} className="h-11 w-full bg-white text-slate-700">
        <Smartphone className="mr-2 h-4 w-4" />
        Set up Workshop Mode on a phone
      </Button>
    );
  }

  return (
    <Card className="gap-0 bg-white py-0 shadow-lg">
      <CardContent className="flex flex-col items-center gap-5 p-4 sm:flex-row sm:items-start">
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-3">
          {qrFailed ? (
            <div className="flex h-44 w-44 items-center justify-center px-3 text-center text-xs text-slate-500">
              The QR code didn't load. Open the link below on the phone instead.
            </div>
          ) : (
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`}
              alt="QR code that opens Workshop Mode on a phone"
              className="h-44 w-44"
              onError={() => setQrFailed(true)}
            />
          )}
        </div>
        <div className="w-full min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <Smartphone className="h-5 w-5" />
                Put Workshop Mode on a phone
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                You're on a computer. Workshop Mode is made for the phone in your hand at the car.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => rememberHidden(true)}
              aria-label="Hide the QR code"
              className="shrink-0 text-slate-400"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <ol className="mt-4 space-y-2.5 text-sm text-slate-700">
            <Step n={1}>Point the phone's camera at the code and tap the link that appears.</Step>
            <Step n={2}>Sign in if it asks.</Step>
            <Step n={3}>
              Follow the steps it shows to add Workshop Mode to the home screen. From then on it opens like an app.
            </Step>
          </ol>
          <div className="mt-4 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs text-slate-600">{url}</code>
            <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0">
              <Copy className="mr-1.5 h-4 w-4" />
              Copy link
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** On the phone: how to add Workshop Mode to the home screen. */
function AddToHomeScreen() {
  const [dismissed, setDismissed] = useState(
    () => !new URLSearchParams(window.location.search).has("install") && readFlag(DISMISS_STEPS_KEY),
  );
  const { canInstall, installed, install } = useInstallPrompt();

  useEffect(() => {
    // Arrived from the setup QR code: forget any earlier "not now", and tidy the flag out of the address bar.
    const url = new URL(window.location.href);
    if (!url.searchParams.has("install")) return;
    writeFlag(DISMISS_STEPS_KEY, false);
    url.searchParams.delete("install");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    writeFlag(DISMISS_STEPS_KEY, true);
  };

  return (
    <Card className="gap-0 border-slate-300 bg-white py-0 shadow-lg">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg bg-slate-900 p-2 text-white">
            <PlusSquare className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold leading-tight text-slate-900">Add Workshop Mode to your home screen</h2>
            <p className="mt-0.5 text-xs text-slate-500">Then it opens full screen, straight into Workshop Mode, like an app.</p>
          </div>
          <button type="button" onClick={dismiss} aria-label="Not now" className="-m-2 shrink-0 p-2 text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {installed ? (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <Check className="h-4 w-4" />
            Installed. Open ELI Workshop from your home screen.
          </p>
        ) : canInstall ? (
          <Button onClick={install} className="mt-3 h-12 w-full rounded-xl bg-slate-900 text-base font-bold hover:bg-slate-800">
            <PlusSquare className="mr-2 h-5 w-5" />
            Install Workshop app
          </Button>
        ) : isApplePhone() ? (
          <ol className="mt-3 space-y-2.5 text-sm text-slate-800">
            <Step n={1}>
              Tap <b>Share</b> <Share className="-mt-1 inline h-4 w-4" />. On newer iPhones it's under <b>•••</b> next to
              the address bar.
            </Step>
            <Step n={2}>
              Tap <b>Add to Home Screen</b>. If it isn't showing, scroll down the list or tap <b>More</b>.
            </Step>
            <Step n={3}>
              Tap <b>Add</b>, then open <b>ELI Workshop</b> from your home screen. Sign in again if it asks.
            </Step>
          </ol>
        ) : (
          <ol className="mt-3 space-y-2.5 text-sm text-slate-800">
            <Step n={1}>
              Tap the browser menu <MoreVertical className="-mt-1 inline h-4 w-4" /> at the top right.
            </Step>
            <Step n={2}>
              Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.
            </Step>
            <Step n={3}>
              Open <b>ELI Workshop</b> from your home screen.
            </Step>
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
