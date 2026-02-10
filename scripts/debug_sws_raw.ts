import "dotenv/config";

const SWS_CONFIG = {
    apiKey: "C94A0F3F12E88DB916C008B069E34F65",
    authHeader: 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
    lookupUrl: 'https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php'
};

async function testRaw() {
    const vrm = "YM14NFL";
    const commonHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': SWS_CONFIG.authHeader,
        'User-Agent': 'Garage Assistant/4.0'
    };

    console.log(`--- Testing RAW SWS API for ${vrm} ---`);

    // 1. LUF
    const lufBody = new URLSearchParams({
        APIKey: SWS_CONFIG.apiKey,
        ACTION: 'LUF',
        VRM: vrm
    });

    const lufRes = await fetch(SWS_CONFIG.lookupUrl, { method: 'POST', headers: commonHeaders, body: lufBody });
    const lufText = await lufRes.text();
    console.log("\n[LUF] RAW RESPONSE:");
    console.log(lufText);

    // 2. ACG
    const acgBody = new URLSearchParams({
        APIKey: SWS_CONFIG.apiKey,
        ACTION: 'ACG',
        VRM: vrm
    });

    const acgRes = await fetch(SWS_CONFIG.lookupUrl, { method: 'POST', headers: commonHeaders, body: acgBody });
    const acgText = await acgRes.text();
    console.log("\n[ACG] RAW RESPONSE:");
    console.log(acgText);
}

testRaw();
