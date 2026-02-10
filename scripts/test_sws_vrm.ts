import { fetchRichVehicleData } from "../server/sws";
import "dotenv/config";

async function test() {
    const vrm = "YM14 NFL";
    console.log(`Testing SWS API for: ${vrm}...`);

    try {
        const data = await fetchRichVehicleData(vrm);
        console.log("--- RESULTS ---");
        console.log("Full Name:", data.specs?.fullName || "Not found");
        console.log("Lubricants:", JSON.stringify(data.lubricants, null, 2));
        console.log("Aircon:", JSON.stringify(data.aircon, null, 2));

        if (data.raw) {
            console.log("Raw Data Found: YES");
        } else {
            console.log("Raw Data Found: NO (Falling back to heuristics)");
        }
    } catch (error) {
        console.error("Test failed:", error);
    }
}

test();
