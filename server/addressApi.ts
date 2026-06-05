// UK postcode -> address finder.
// Full house-level lookups use getAddress.io (needs GETADDRESS_API_KEY — free trial available).
// Without a key it falls back to the free postcodes.io, which only resolves town/county/region.

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

  const key = process.env.GETADDRESS_API_KEY;
  if (key) {
    try {
      const res = await fetch(`https://api.getaddress.io/find/${encodeURIComponent(pc)}?api-key=${key}&expand=true`);
      if (res.ok) {
        const data: any = await res.json();
        const addresses: FoundAddress[] = (data?.addresses || []).map((a: any) => {
          const houseNo = [a.sub_building_name, a.building_name, a.building_number, a.sub_building_number].filter(Boolean).join(" ").trim();
          const road = (a.thoroughfare || a.line_1 || "").trim();
          const town = (a.town_or_city || "").trim();
          const county = (a.county || a.district || "").trim();
          const locality = (a.locality || (a.line_2 && a.line_2 !== town ? a.line_2 : "") || "").trim();
          const label = (Array.isArray(a.formatted_address) ? a.formatted_address.filter(Boolean).join(", ") : [houseNo && `${houseNo} ${road}`.trim(), locality, town, county].filter(Boolean).join(", "));
          return { houseNo, road, locality, town, county, label };
        });
        return { source: "getAddress.io", full: true, addresses };
      }
      if (res.status === 404) return { source: "getAddress.io", full: true, addresses: [], note: "No addresses found for that postcode" };
    } catch { /* fall through to postcodes.io */ }
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
      note: "Street(s) found free of charge — enter the house number (a getAddress.io key adds full house-level addresses)." };
  }
  if (area) {
    return { source: "postcodes.io", full: false,
      addresses: [{ houseNo: "", road: "", locality: area.locality, town: area.town, county: area.county, label: `${area.town}${area.county ? `, ${area.county}` : ""} — enter house & street` }],
      note: "Area found free. The street/house need a licensed lookup — add a getAddress.io key for full addresses." };
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
