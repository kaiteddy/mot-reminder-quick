import "dotenv/config";
import { getAppSetting } from "../server/db";
import https from "https";

async function test() {
  const session = await getAppSetting("autodata_tokens");

  if (!session || !session.rawCookies) {
    console.log("No raw cookies found in db!");
    process.exit(1);
  }

  // Deduplicate cookies
  const cookieParts = session.rawCookies.split(';').map(c => c.trim());
  const uniqueCookies = new Map();
  for (const part of cookieParts) {
    if (!part) continue;
    const splitIndex = part.indexOf('=');
    if (splitIndex === -1) continue;
    const name = part.substring(0, splitIndex);
    const value = part.substring(splitIndex + 1);
    uniqueCookies.set(name, value);
  }

  const cleanCookies = Array.from(uniqueCookies.entries())
    .map(([key, val]) => `${key}=${val}`)
    .join('; ');

  console.log("Using clean cookies length:", cleanCookies.length);

  const headers = {
    "Cookie": cleanCookies,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Origin": "https://workshop.autodata-group.com",
    "Referer": "https://workshop.autodata-group.com/w2/engine-oil/TOY43021%3Fvrm%3DRE71VOD",
    "xhr-request-from": "workshop",
    "sec-ch-ua": "\"Not:A-Brand\";v=\"99\", \"Google Chrome\";v=\"145\", \"Chromium\";v=\"145\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "priority": "u=1, i"
  };

  const urlsToTry = [
    "https://workshop.autodata-group.com/w2/api/user?v=5c1542c252dd2c6f7e257b2dd19f2c09390a570f&language=en-gb"
  ];

  // We use a custom fetch implementation to better mimic a browser if necessary, 
  // but let's try standard fetch first. Let's see if deduplicated cookies fix the 302.

  for (const url of urlsToTry) {
    console.log(`\nTrying ${url}...`);
    try {
      const res = await fetch(url, {
        headers,
        redirect: "manual",
      });
      console.log(`Status: ${res.status} ${res.statusText}`);
      if (res.status === 302 || res.status === 301) {
        console.log("Got Redirect to:", res.headers.get('location'));
      }
      const body = await res.text().catch(() => "");
      if (body) {
        console.log("Length:", body.length);
        console.log(body.substring(0, 1000));
      }
    } catch (e: any) {
      console.log(`Failed fetching ${url}: ${e.message}`);
    }
  }

  process.exit(0);
}
test();
