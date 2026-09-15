// Omnipart session refresher — keeps appSettings.omnipart_jwt_token fresh so the live order
// tracker / invoice pulls keep working without anyone copying tokens by hand.
//
// It uses its OWN persistent Chrome profile (~/.omnipart-session), separate from your main browser.
// Seed it ONCE by hand (solves the login CAPTCHA), after which scheduled runs are unattended: each
// run loads an authenticated page, lets the app silent-refresh the bearer via the refresh_token
// cookie, grabs the FULL cookie jar (incl. HttpOnly, via CDP), and posts it as COOKIE_JAR: to the
// webhook. No password is stored anywhere — the seeded profile is the credential.
//
//   node omnipart-session-refresh.mjs --seed   # one-time: opens a real window, you log in + solve CAPTCHA
//   node omnipart-session-refresh.mjs          # unattended: refresh the jar (run by launchd)
//
// Exit codes: 0 ok · 2 session lapsed (re-seed needed) · 1 error.
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteer.use(StealthPlugin());

const SEED = process.argv.includes("--seed");
const PROFILE = `${process.env.HOME}/.omnipart-session`;
const WEBHOOK = "https://mot-reminder-quick.vercel.app/api/webhooks/omnipart";
const TARGET = "https://omnipart.eurocarparts.com/account/order-tracking";

function stamp() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function log(...a) { console.log(`[${stamp()}] [omnipart-refresh]`, ...a); }

function bearerInfo(jar) {
  const m = jar.match(/bearer=(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (!m) return { ok: false };
  try {
    const p = JSON.parse(Buffer.from(m[1].split(".")[1], "base64").toString());
    return { ok: !!(p.username && p.username.includes("@") && !p.guest_user), exp: p.exp, user: p.username };
  } catch { return { ok: false }; }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: SEED ? false : "new",
    userDataDir: PROFILE,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled",
           // headless-under-launchd stability: no GPU/shm reliance in a headless daemon context
           ...(SEED ? ["--start-maximized"] : ["--disable-gpu", "--disable-software-rasterizer", "--disable-dev-shm-usage"])],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const cdp = await page.target().createCDPSession();

    // domcontentloaded is enough to boot the SPA; the settle wait below covers the /me + silent
    // refresh calls. (networkidle2 never fires on Omnipart — too many keep-alive requests.)
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, SEED ? 0 : 7000));

    if (SEED) {
      log("SEED mode: log in and solve the CAPTCHA in the window. Waiting up to 4 min for a trade session…");
      for (let i = 0; i < 160; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const { cookies } = await cdp.send("Network.getAllCookies");
        const jar = cookies.filter((c) => /eurocarparts\.com|omnipart/.test(c.domain)).map((c) => `${c.name}=${c.value}`).join("; ");
        if (bearerInfo(jar).ok) { log("Trade session detected — profile seeded."); break; }
      }
    } else {
      // let any silent refresh settle
      await new Promise((r) => setTimeout(r, 4000));
    }

    const { cookies } = await cdp.send("Network.getAllCookies");
    const ecp = cookies.filter((c) => /eurocarparts\.com|omnipart/.test(c.domain));
    const jar = ecp.map((c) => `${c.name}=${c.value}`).join("; ");
    // Log the refresh_token lifetime each run: if this stays near its max across runs, ECP rolls
    // the session and this stays live forever; if it counts down, a re-login will eventually be due.
    const rt = ecp.find((c) => c.name === "refresh_token");
    const rtLife = rt && rt.expires > 0 ? `${((rt.expires - Date.now() / 1000) / 3600).toFixed(1)}h` : "n/a";
    const info = bearerInfo(jar);
    if (!info.ok) {
      log("No valid trade session — the ECP login has lapsed. Re-seed:  node omnipart-session-refresh.mjs --seed");
      await browser.close();
      process.exit(2);
    }
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "COOKIE_JAR:" + jar }),
    });
    const mins = Math.round((info.exp - Date.now() / 1000) / 60);
    log(`Posted fresh jar for ${info.user} (bearer ~${mins} min left, refresh_token ${rtLife}) → webhook HTTP ${res.status}`);
    await browser.close();
  } catch (e) {
    log("error:", e?.message || e);
    try { await browser.close(); } catch {}
    process.exit(1);
  }
}
main();
