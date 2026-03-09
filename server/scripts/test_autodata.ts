import "dotenv/config";
import { getAppSetting } from "../db";

async function test() {
  const accountId = await getAppSetting("autodata_tokens").then(res => res?.pendoAccountId ? JSON.parse(res.pendoAccountId).value : null);
  const session = await getAppSetting("autodata_tokens");
  
  if (!session || !session.awswaf) {
    console.log("No tokens found!");
    process.exit(1);
  }

  const tokens = session;
  const awswaf = tokens.awswaf;
  
  const headers = {
    "Cookie": `awswaf_session_storage=${awswaf};`,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Origin": "https://workshop.autodata-group.com",
    "Referer": "https://workshop.autodata-group.com/"
  };

  const url = "https://workshop.autodata-group.com/w1/service-schedules/OPL16080?vrm=DY60WXE";

  console.log(`Fetching HTML from ${url}...`);
  try {
      const res = await fetch(url, { headers });
      if (res.ok) {
          const text = await res.text();
          console.log("SUCCESS!");
          
          // Dump all strings that look like /w2/api/... or /v1/...
          const apiMatches = text.match(/"\/[wv][12]\/[^"]+"/g);
          if (apiMatches) {
             console.log("Found API endpoints mapped in HTML:");
             const unique = [...new Set(apiMatches)];
             console.log(unique.join("\n"));
          } else {
             console.log("No API mappings found in HTML.");
             console.log(text.substring(0, 1000));
          }
      } else {
          console.log(`Failed: ${res.status}`);
          console.log(await res.text());
      }
  } catch (e: any) {
      console.log(`Failed fetching ${url}: ${e.message}`);
  }

  process.exit(0);
}
test();
