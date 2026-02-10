import "dotenv/config";

const SWS_CONFIG = {
    apiKey: "C94A0F3F12E88DB916C008B069E34F65",
    authHeader: 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
    lookupUrl: 'https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php'
};

async function testAircon() {
    const vrm = "YM14NFL";
    const commonHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': SWS_CONFIG.authHeader,
        'User-Agent': 'Garage Assistant/4.0'
    };

    const actions = [
        { ACTION: 'GET_AIRCON' },
        { ACTION: 'ACG' },
        { ACTION: 'GET_AIRCONDITIONING' }
    ];

    for (const params of actions) {
        console.log(`\n--- Testing ${params.ACTION} ---`);
        const body = new URLSearchParams({
            APIKey: SWS_CONFIG.apiKey,
            VRM: vrm,
            ...params
        });

        const res = await fetch(SWS_CONFIG.lookupUrl, { method: 'POST', headers: commonHeaders, body: body });
        const text = await res.text();
        console.log("Response text length:", text.length);
        if (text.length > 0) {
            console.log("Found data for:", params.ACTION);
        }
    }
}

testAircon();
