// ⚠️ RETIRED (2026-09-15): under single-login mode this is NOT used. It refreshes/rotates the
// ECP token server-side, which invalidates the browser's own session — kept only for reference.

// Omnipart session self-renewal — pure server-side, no browser, no CAPTCHA, runs forever.
//
// ECP rotates its refresh_token: POST /token/refresh with the current refresh_token returns a NEW
// bearer AND a NEW refresh_token. So as long as this runs at least once inside the refresh_token's
// ~12h life (we run every 40 min), the session renews itself indefinitely with zero human input.
// This is a token REFRESH, not a login, so it never triggers the CAPTCHA.
//
// Flow: read current jar from the webhook -> POST /token/refresh -> splice the new bearer +
// refresh_token back into the jar -> save the jar back. If the refresh_token has lapsed (only
// possible after a >12h gap with no run), it exits 2 and the one-time seed is needed again.
//
// Exit: 0 renewed · 2 chain broken (re-seed) · 1 error.
const WEBHOOK = "https://mot-reminder-quick.vercel.app/api/webhooks/omnipart";
const API = "https://api.omnipart.eurocarparts.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function stamp() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function log(...a) { console.log(`[${stamp()}] [omnipart-token-refresh]`, ...a); }

function bearerMins(jwt) {
  try { const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
    return { user: p.username, mins: Math.round((p.exp - Date.now() / 1000) / 60), guest: p.guest_user }; }
  catch { return null; }
}

async function main() {
  // 1. current jar
  const cur = await fetch(WEBHOOK).then((r) => r.json()).catch(() => ({}));
  let jar = (cur && cur.token) || "";
  if (jar.startsWith("COOKIE_JAR:")) jar = jar.slice("COOKIE_JAR:".length);
  const rt = jar.match(/refresh_token=([0-9a-fA-F]+)/);
  if (!rt) { log("No refresh_token in stored jar — one-time seed needed (node omnipart-session-refresh.mjs --seed)."); process.exit(2); }

  // 2. refresh (rotates the refresh_token)
  const res = await fetch(`${API}/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json",
      "Origin": "https://omnipart.eurocarparts.com", "Referer": "https://omnipart.eurocarparts.com/",
      "User-Agent": UA, "Cookie": jar },
    body: JSON.stringify({ refresh_token: rt[1] }),
  });
  if (!res.ok) { log(`/token/refresh -> HTTP ${res.status}. refresh_token has lapsed — re-seed needed.`); process.exit(2); }
  const data = await res.json();
  if (!data.token || !data.refresh_token) { log("refresh response missing token/refresh_token:", JSON.stringify(data).slice(0, 120)); process.exit(1); }

  const who = bearerMins(data.token);
  if (!who || who.guest) { log("refresh returned a non-trade/guest token — re-seed needed."); process.exit(2); }

  // 3. splice the NEW bearer + NEW refresh_token into the jar (MUST keep the rotated refresh_token,
  //    or the next run's refresh will fail).
  let newJar = jar;
  newJar = /bearer=/.test(newJar) ? newJar.replace(/bearer=[^;]*/, `bearer=${data.token}`) : `${newJar}; bearer=${data.token}`;
  newJar = newJar.replace(/refresh_token=[^;]*/, `refresh_token=${data.refresh_token}`);

  // 4. save
  const save = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "COOKIE_JAR:" + newJar }) });
  log(`Renewed session for ${who.user} (bearer ~${who.mins} min, refresh_token rotated) -> saved HTTP ${save.status}`);
}

main().catch((e) => { log("error:", e?.message || e); process.exit(1); });
