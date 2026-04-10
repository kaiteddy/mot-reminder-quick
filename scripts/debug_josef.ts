import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if(!db) throw new Error("No db");
  
  const cList = await db.select().from(customers).where(eq(customers.id, 3840));
  console.log("Customer:", cList[0]);
  
  const vList = await db.select().from(vehicles).where(eq(vehicles.customerId, 3840));
  console.log("Vehicles:", vList);
}

main().catch(console.error).then(() => process.exit(0));
