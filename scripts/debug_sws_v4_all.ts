import "dotenv/config";

const SWS_CONFIG = {
    apiKey: "C94A0F3F12E88DB916C008B069E34F65",
    authHeader: 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
    lookupUrl: 'https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php'
};

async function testV4_All() {
    const vrm = "YM14NFL";
    const commonHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': SWS_CONFIG.authHeader,
        'User-Agent': 'Garage Assistant/4.0'
    };

    const actions = ['Luf', 'Acg', 'GET_LUBRICANTS', 'GET_AIRCON', 'GET_TECHNICAL_DATA'];

    for (const action of actions) {
        console.log(`\n--- Testing ${action} ---`);
        const body = new URLSearchParams({
            APIKey: SWS_CONFIG.apiKey,
            ACTION: action,
            VRM: vrm
        });

        const res = await fetch(SWS_CONFIG.lookupUrl, { method: 'POST', headers: commonHeaders, body: body });
        const text = await res.text();
        console.log("Response length:", text.length);
        if (text.length > 50) {
            console.log("Data snippet:", text.substring(0, 500));
        }
    }
}

testV4_All();
