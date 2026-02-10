import "dotenv/config";

const SWS_CONFIG = {
    apiKey: "C94A0F3F12E88DB916C008B069E34F65",
    authHeader: 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
    lookupUrl: 'https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php'
};

async function testV4_Groups() {
    const vrm = "YM14NFL";
    const commonHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': SWS_CONFIG.authHeader,
        'User-Agent': 'Garage Assistant/4.0'
    };

    const action = "GET_ADJUSTMENTS";
    const res = await fetch(SWS_CONFIG.lookupUrl, {
        method: 'POST',
        headers: commonHeaders,
        body: new URLSearchParams({ APIKey: SWS_CONFIG.apiKey, ACTION: action, VRM: vrm })
    });
    const text = await res.text();
    const data = JSON.parse(text);
    const adjustments = data?.[0]?.TechnicalData?.ExtAdjustment || [];

    adjustments.forEach((group: any) => {
        if (["Cooling system", "Air conditioning", "Capacities"].includes(group.name)) {
            console.log(`\n--- ${group.name} ---`);
            console.log(JSON.stringify(group.subAdjustments?.item, null, 2));
        }
    });
}

testV4_Groups();
