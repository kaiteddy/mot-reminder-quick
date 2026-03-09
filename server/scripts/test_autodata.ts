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
  const pendoSessionIdObject = JSON.parse(tokens.pendoSessionId || "{}");
  
  const headers = {
    "Cookie": `awswaf_session_storage=${awswaf};`,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Accept": "application/json",
    "Origin": "https://workshop.autodata-group.com",
    "Referer": "https://workshop.autodata-group.com/"
  };

  const urlsToTry = [
    "https://api-eu.autodata-group.com/v1/vehicles?vrm=RE71VOD&country-code=gb",
    "https://api.autodata-group.com/v1/vehicles?vrm=RE71VOD&country-code=gb",
    "https://workshop.autodata-group.com/api/v1/vehicles?vrm=RE71VOD&country-code=gb",
    "https://workshop.autodata-group.com/v1/vehicles?vrm=RE71VOD&country-code=gb",
    "https://api.workshop.autodata-group.com/v1/vehicles?vrm=RE71VOD&country-code=gb"
  ];

  for (const url of urlsToTry) {
     console.log(`Trying ${url}...`);
     try {
       const res = await fetch(url, { headers });
       if (res.ok) {
           console.log(`SUCCESS on ${url}`);
           console.log(await res.json());
           break;
       } else {
           console.log(`Failed: ${res.status}`);
       }
     } catch (e: any) {
        console.log(`Failed fetching ${url}: ${e.message}`);
     }
  }

  process.exit(0);
}
test();
