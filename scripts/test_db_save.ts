import "dotenv/config";
import { saveAppSetting } from "../server/db";

async function test() {
  try {
    console.log("Saving...");
    await saveAppSetting('autodata_tokens', { test: "data", rawCookies: "test_cookie" });
    console.log("Saved.");
  } catch (e: any) {
    console.log("Error:", e.message);
  }
  process.exit(0);
}
test();
