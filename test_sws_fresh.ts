
import { fetchRichVehicleData } from "./server/sws.js";

async function test() {
    console.log("Fetching technical data for LN64XFG...");
    const data = await fetchRichVehicleData("LN64XFG");
    console.log("RESULT:", JSON.stringify(data, null, 2));
}

test().catch(console.error);
