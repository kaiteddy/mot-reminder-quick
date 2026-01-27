import "dotenv/config";

async function testBoth() {
    const API_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";
    const API_KEY = process.env.DVLA_API_KEY;

    const regs = ["AV06BPE", "AV06 BPE"];

    for (const reg of regs) {
        console.log(`Testing [${reg}]...`);
        const resp = await fetch(API_URL, {
            method: "POST",
            headers: {
                "x-api-key": API_KEY || "",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ registrationNumber: reg }),
        });

        if (resp.status === 200) {
            console.log(`Success for [${reg}]:`, await resp.json());
        } else {
            console.log(`Fail for [${reg}]: ${resp.status} ${await resp.text()}`);
        }
    }
}

testBoth().catch(console.error);
