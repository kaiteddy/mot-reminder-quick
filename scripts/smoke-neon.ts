/** Smoke-test the ported db.ts queries against Neon (uses DATABASE_URL_NEON via getDb). */
import "dotenv/config";
import * as db from "../server/db";

function summarize(r: any): string {
  if (Array.isArray(r)) return `array(${r.length})` + (r[0] ? ` keys=[${Object.keys(r[0]).slice(0, 6).join(",")}]` : "");
  if (r && typeof r === "object") return `obj keys=[${Object.keys(r).slice(0, 8).join(",")}]`;
  return JSON.stringify(r);
}
async function run(name: string, fn: () => Promise<any>) {
  try { console.log(`✓ ${name.padEnd(42)} -> ${summarize(await fn())}`); }
  catch (e: any) { console.log(`✗ ${name.padEnd(42)} -> ERROR: ${e.message}`); process.exitCode = 1; }
}

async function main() {
  await run("getDocuments(sort=date)", () => db.getDocuments({ limit: 5, sortKey: "date", sortDir: "desc" }));
  await run("getDocuments(sort=docNo)", () => db.getDocuments({ limit: 5, sortKey: "docNo", sortDir: "desc" }));
  await run("getDocuments(search=cohen)", () => db.getDocuments({ search: "cohen", limit: 5 }));
  await run("getDocumentStats()", () => db.getDocumentStats());
  const veh: any = await db.getVehicleByRegistration("FL13 CNN");
  await run("getVehicleByRegistration(FL13 CNN)", async () => veh);
  await run("searchVehiclesForJob(FL13)", () => db.searchVehiclesForJob("FL13"));
  await run("suggestParts(brake)", () => db.suggestParts("brake"));
  await run("searchCustomers(cohen)", () => db.searchCustomers("cohen"));
  await run("globalSearch(cohen)", () => db.globalSearch("cohen"));
  await run("getAddressLookupStats()", () => db.getAddressLookupStats());
  if (veh?.id) {
    await run("getServiceHistoryByVehicleId(veh)", () => db.getServiceHistoryByVehicleId(veh.id));
    if (veh.customerId) await run("getCustomerAccountNumber(cust)", () => db.getCustomerAccountNumber(veh.customerId));
  }
  process.exit(process.exitCode || 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
