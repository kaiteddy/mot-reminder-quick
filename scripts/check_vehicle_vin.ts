import { db } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function run() {
    const vrm = "LN64XFG";
    const result = await db.select().from(vehicles).where(eq(vehicles.registration, vrm));
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
}

run();
