import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if(!db) throw new Error("No db");
  
  const vReg = "LN64XFG";
  
  const vList = await db.select().from(vehicles).where(eq(vehicles.customerId, 3840));
  console.log(`Vehicles owned by Josef Mosafi:`, vList.length);
  
  for (const v of vList) {
    console.log(`- Vehicle ID: ${v.id}, Reg: ${v.registration}, Make: ${v.make}, Model: ${v.model}`);
  }
}

main().catch(console.error).then(() => process.exit(0));
