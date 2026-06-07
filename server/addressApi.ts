// UK postcode -> address finder.
// Full house-level lookups use Ideal Postcodes (a licensed Royal Mail PAF provider; needs
// IDEALPOSTCODES_API_KEY). Without a key it falls back to the free, open postcodes.io
// (town/county) + OpenStreetMap (street where mapped). getAddress.io is deliberately NOT
// used — an Oct-2025 High Court ruling held its address data infringes Royal Mail/IDDQD rights.

export type FoundAddress = {
  houseNo: string;
  road: string;
  locality: string;
  town: string;
  county: string;
  label: string;
};

const cleanPostcode = (pc: string) => (pc || "").toUpperCase().replace(/\s+/g, "");

export async function lookupAddresses(postcode: string): Promise<{ source: string; full: boolean; addresses: FoundAddress[]; note?: string }> {
  const pc = cleanPostcode(postcode);
  if (!pc || pc.length < 5) return { source: "none", full: false, addresses: [], note: "Enter a full postcode" };

  const key = process.env.IDEALPOSTCODES_API_KEY;
  if (key) {
    // Addresses for a postcode are static — cache the (paid) Ideal Postcodes result and serve
    // repeat searches for the same postcode for free, so we never pay twice for it.
    const cacheKey = `addrcache:${pc}`;
    try {
      const { getAppSetting } = await import("./db");
      const cached: any = await getAppSetting(cacheKey);
      if (cached && Array.isArray(cached.addresses) && cached.addresses.length) {
        return { source: "Ideal Postcodes (cached)", full: true, addresses: cached.addresses };
      }
    } catch { /* cache read best-effort */ }
    try {
      const res = await fetch(`https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(pc)}?api_key=${key}`);
      if (res.ok) {
        const data: any = await res.json();
        const addresses: FoundAddress[] = (data?.result || []).map((a: any) => {
          const houseNo = [a.sub_building_name, a.building_name, a.building_number].filter(Boolean).join(" ").trim();
          const road = (a.thoroughfare || a.line_1 || "").trim();
          const town = (a.post_town || "").trim();
          const countyRaw = (a.county || a.traditional_county || a.administrative_county || "").trim();
          const county = countyRaw && countyRaw.toLowerCase() !== town.toLowerCase() ? countyRaw : ""; // drop e.g. "London, London"
          const locality = (a.dependant_locality || a.double_dependant_locality || "").trim();
          const label = [a.line_1, a.line_2, a.line_3, town, county].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(", ");
          return { houseNo, road, locality, town, county, label };
        });
        if (addresses.length) {
          try { const { saveAppSetting } = await import("./db"); await saveAppSetting(cacheKey, { addresses, cachedAt: new Date().toISOString() }); } catch { /* cache write best-effort */ }
        }
        return { source: "Ideal Postcodes", full: true, addresses, note: addresses.length ? undefined : "No addresses found for that postcode" };
      }
    } catch { /* fall through to the free lookup */ }
  }

  // --- Free, best-effort lookup (no key) ---
  // The free postcodes.io gives the area (town/county). OpenStreetMap may also know the
  // street for some postcodes — UK postcode->street/house is Royal Mail PAF data (licensed),
  // so it isn't reliably available free.
  const area = await postcodesIoArea(pc);
  const roads = await nominatimRoads(pc); // only results that actually carry a road
  if (roads.length) {
    const addresses = roads.map((r) => ({
      houseNo: "",
      road: r.road,
      locality: r.locality || area?.locality || "",
      town: r.town || area?.town || "",
      county: r.county || area?.county || "",
      label: [r.road, area?.town || r.town, area?.county || r.county].filter(Boolean).join(", "),
    }));
    return { source: "OpenStreetMap + postcodes.io", full: false, addresses,
      note: "Street(s) found free of charge — enter the house number (an Ideal Postcodes key adds full house-level addresses)." };
  }
  if (area) {
    return { source: "postcodes.io", full: false,
      addresses: [{ houseNo: "", road: "", locality: area.locality, town: area.town, county: area.county, label: `${area.town}${area.county ? `, ${area.county}` : ""} — enter house & street` }],
      note: "Area found free. The street/house need a licensed lookup — add an Ideal Postcodes key for full addresses." };
  }
  return { source: "none", full: false, addresses: [], note: "Address lookup unavailable" };
}

/** Free area lookup (town/county/region) via postcodes.io — no street. */
async function postcodesIoArea(pc: string): Promise<{ locality: string; town: string; county: string } | null> {
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
    if (!res.ok) return null;
    const r = (await res.json())?.result;
    if (!r) return null;
    return { locality: r.admin_ward || "", town: r.admin_district || r.parish || "", county: r.region || r.country || "" };
  } catch { return null; }
}

/** Best-effort free street lookup via OpenStreetMap — only returns results that carry a road. */
async function nominatimRoads(pc: string): Promise<{ road: string; locality: string; town: string; county: string }[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(pc)}&countrycodes=gb&format=jsonv2&addressdetails=1&limit=25`;
    const res = await fetch(url, { headers: { "User-Agent": "ELI-Motors-Garage-App/1.0 (admin@elimotors.co.uk)", "Accept-Language": "en-GB" } });
    if (!res.ok) return [];
    const data: any = await res.json();
    const seen = new Set<string>();
    const out: { road: string; locality: string; town: string; county: string }[] = [];
    for (const r of data || []) {
      const a = r.address || {};
      const road = (a.road || a.pedestrian || a.residential || "").trim();
      if (!road || seen.has(road)) continue;
      seen.add(road);
      out.push({
        road,
        locality: (a.suburb || a.neighbourhood || "").trim(),
        town: (a.city || a.town || a.village || "").trim(),
        county: (a.county || a.state_district || "").trim(),
      });
    }
    return out;
  } catch { return []; }
}
