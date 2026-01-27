import "dotenv/config";
import { getVehicleDetails } from "../server/dvlaApi";
import { getMOTHistory } from "../server/motApi";

async function debugVehicle(reg: string) {
    console.log(`\n--- Debugging Reg: ${reg} ---`);

    try {
        console.log("Calling DVLA API...");
        const dvla = await getVehicleDetails(reg);
        if (dvla) {
            console.log("DVLA Response:", JSON.stringify(dvla, null, 2));
        } else {
            console.log("DVLA Response: null or failure");
        }
    } catch (err: any) {
        console.error("DVLA Error:", err.message);
    }

    try {
        console.log("\nCalling MOT API...");
        const mot = await getMOTHistory(reg);
        if (mot) {
            console.log("MOT History found. Latest test:", JSON.stringify(mot.motTests?.[0], null, 2));
        } else {
            console.log("MOT History: null or not found");
        }
    } catch (err: any) {
        console.error("MOT Error:", err.message);
    }
}

async function run() {
    const regs = ["AV06BPE", "LJ59GWX", "R4TEA", "R4TEA*", "MW18AFX", "E066BZR", "EO66BZR"];
    for (const reg of regs) {
        await debugVehicle(reg);
    }
}

run().catch(console.error);
