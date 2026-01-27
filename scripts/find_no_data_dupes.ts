import "dotenv/config";
import { getAllVehiclesWithCustomers } from "../server/db";

async function findNoData() {
    const all = await getAllVehiclesWithCustomers();
    const noData = all.filter(v => !v.motExpiryDate);

    console.log(`Found ${noData.length} vehicles with null motExpiryDate.`);

    const targetRegs = ["MV63ANX", "LK04JKZ", "ET07XZW", "MW18 AFX", "AV06 BPE", "LJ59GWX", "R4 TEA*", "E066 BZR"];

    noData.forEach(v => {
        if (targetRegs.includes(v.registration!) || (v.registration && v.registration.includes("BZR"))) {
            console.log(`ID: ${v.id}, Reg: [${v.registration}], Status: ${v.taxStatus}`);
        }
    });

    // Also check if any of these targetRegs have multiple entries
    console.log("\nChecking for duplicates of target regs...");
    for (const reg of targetRegs) {
        const entries = all.filter(v => v.registration === reg);
        if (entries.length > 1) {
            console.log(`Reg: [${reg}] found ${entries.length} times!`);
            entries.forEach(e => console.log(`  ID: ${e.id}, MOT: ${e.motExpiryDate}`));
        }
    }
}

findNoData().catch(console.error);
