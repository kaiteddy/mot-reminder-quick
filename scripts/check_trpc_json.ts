import "dotenv/config";
import { getAllVehiclesWithCustomers } from "../server/db";

async function checkJson() {
    const all = await getAllVehiclesWithCustomers();
    const regs = ["MV63ANX", "LK04JKZ", "ET07XZW", "MW18 AFX", "AV06 BPE", "LJ59GWX", "R4 TEA*", "E066 BZR"];

    const matches = all.filter(v =>
        regs.includes(v.registration!) ||
        (v.registration && (v.registration.includes("66") && v.registration.includes("BZR")))
    );

    console.log(`Found ${matches.length} matches in TRPC-style output.`);
    matches.forEach(v => {
        console.log(`Reg: [${v.registration}], MOT: ${v.motExpiryDate} (${typeof v.motExpiryDate})`);
    });
}

checkJson().catch(console.error);
