import { getDb } from "../server/db";
import { customers, vehicles } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if(!db) throw new Error("No db");
  
  // Create Eli Motors
  console.log("Creating Eli Motors profile...");
  const [result] = await db.insert(customers).values({
    name: "Eli Motors",
    phone: "07883995527", // the shared number
    address: "",
    postcode: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  
  const insertId = (result as any).insertId;
  console.log(`Created Eli Motors with ID: ${insertId}`);

  // Transfer LN64XFG to Eli Motors
  console.log("Transferring LN64XFG to Eli Motors...");
  await db.update(vehicles).set({ customerId: insertId }).where(eq(vehicles.registration, "LN64XFG"));

  // Check what other cars were under Josef Mosafi (ID 3840)
  const remaining = await db.select().from(vehicles).where(eq(vehicles.customerId, 3840));
  console.log(`Remaining cars under Josef Mosafi (ID: 3840): ${remaining.map(v => v.registration).join(", ")}`);
  console.log(`You can unlink these via the new UI if they also belong to Eli Motors.`);
}

main().catch(console.error).then(() => process.exit(0));
