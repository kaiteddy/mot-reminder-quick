// Trakm8's free OBD checker (the tool behind chillidrive.com/obdhelp) exposes the lookup
// chain its widget uses: makes -> models -> years -> compatibility (location_id), and the
// interior diagram PNGs live at a predictable asset path. Used to auto-attach the diagram
// to the Service Reset card. Every failure returns null — the card works fine without it.
const TRAKM8_API = "https://api-core01.trakm8.net:8443/devicecompatibility";
const TRAKM8_ASSETS = "https://obdchecker.trakm8.net/assets/branding/trakm8/img/obd-locations";
export async function fetchTrakm8ObdImage(make?: string | null, model?: string | null, regYear?: number | null):
  Promise<{ locationId: number; dataBase64: string; matched: string } | null> {
  try {
    const get = async (url: string) => {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      return r;
    };
    const mk = (make || "").trim().toUpperCase();
    const mdl = (model || "").trim().toUpperCase();
    if (!mk || !mdl) return null;
    const makesR = await get(`${TRAKM8_API}/vehicle/makes`);
    if (!makesR) return null;
    const makes: string[] = await makesR.json();
    const ALIASES: Record<string, string> = { "MERCEDES": "MERCEDES-BENZ", "VW": "VOLKSWAGEN" };
    const useMake = makes.includes(mk) ? mk : (ALIASES[mk] && makes.includes(ALIASES[mk]) ? ALIASES[mk] : makes.find((m) => mk.startsWith(m) || m.startsWith(mk)));
    if (!useMake) return null;
    const modelsR = await get(`${TRAKM8_API}/vehicle/makes/models?make=${encodeURIComponent(useMake)}`);
    if (!modelsR) return null;
    const models: string[] = await modelsR.json();
    // Our model strings are richer ("Cayenne (9YA) 3.0 E-Hybrid") — pick the longest
    // Trakm8 model name contained in ours.
    const useModel = models.filter((m) => mdl.includes(m)).sort((a, b) => b.length - a.length)[0];
    if (!useModel) return null;
    const yearsR = await get(`${TRAKM8_API}/vehicle/makes/models/years?make=${encodeURIComponent(useMake)}&model=${encodeURIComponent(useModel)}`);
    if (!yearsR) return null;
    const years: number[] = await yearsR.json();
    if (!years.length) return null;
    // Nearest listed year to the reg year (their lists often stop earlier than current cars;
    // the port location almost never moves within a generation).
    const useYear = regYear ? years.reduce((best, y) => Math.abs(y - regYear) < Math.abs(best - regYear) ? y : best, years[0]) : Math.max(...years);
    const compR = await fetch(`${TRAKM8_API}/vehicle/compatibility`, {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ make: useMake, model: useModel, year: String(useYear) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!compR.ok) return null;
    const comp = await compR.json();
    if (comp?.location_id == null) return null;
    for (const dpi of ["2x", "1x"]) {
      const imgR = await get(`${TRAKM8_ASSETS}/${dpi}/${comp.location_id}.png`);
      if (!imgR) continue;
      const buf = Buffer.from(await imgR.arrayBuffer());
      // The SPA serves its index.html for missing assets — a real diagram is a PNG.
      if (buf.length < 500 || buf[0] !== 0x89) continue;
      return { locationId: comp.location_id, dataBase64: buf.toString("base64"), matched: `${useMake} ${useModel} ${useYear}` };
    }
    return null;
  } catch {
    return null;
  }
}

