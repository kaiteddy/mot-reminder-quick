import "dotenv/config";
import { getMOTHistory, getLatestMOTExpiry } from "../server/motApi";
import fs from "fs";

async function main() {
    const reg = "LX62UCB";
    try {
        const mot = await getMOTHistory(reg);
        console.log("Got MOT History from DVSA DVLA API");
        if (mot) {
            fs.writeFileSync("dvsa_mot_output.json", JSON.stringify(mot, null, 2));
            console.log("Parsed Expiry Date:", getLatestMOTExpiry(mot));
        }
    } catch (e) {
        console.error(e);
    }
}

main();
