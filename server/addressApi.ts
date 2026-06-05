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

  // Free fallback — resolves the area (town/county) only, not the street/house.
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
    if (res.ok) {
      const data: any = await res.json();
      const r = data?.result;
      if (r) {
        return {
          source: "postcodes.io", full: false,
          addresses: [{ houseNo: "", road: "", locality: r.admin_ward || "", town: r.admin_district || r.parish || "", county: r.region || r.country || "", label: `${r.admin_district || ""}${r.region ? `, ${r.region}` : ""} — enter house & street` }],
          note: "Area found (free lookup). Add a getAddress.io key for full house-level addresses.",
        };
      }
    }
  } catch { /* ignore */ }

  return { source: "none", full: false, addresses: [], note: "Address lookup unavailable" };
}
