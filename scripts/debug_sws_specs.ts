import "dotenv/config";

const SWS_CONFIG = {
    apiKey: "C94A0F3F12E88DB916C008B069E34F65",
    authHeader: 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
    lookupUrl: 'https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php'
};

async function testSpecs() {
    const vrm = "YM14NFL";
    const commonHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': SWS_CONFIG.authHeader,
        'User-Agent': 'Garage Assistant/4.0'
    };

    const action = 'GET_TECHNICAL_DATA';
    // Let's try to get ALL technical data or specifically adjustments
    const subjects = ['ADJUSTMENTS', 'MAINTENANCE', 'AC_DATA', 'CAPACITIES'];

    for (const sub of subjects) {
        console.log(`\n--- Testing ${sub} ---`);
        const body = new URLSearchParams({
            APIKey: SWS_CONFIG.apiKey,
            VRM: vrm,
            ACTION: action,
            SUBJECT: sub
        });

        const res = await fetch(SWS_CONFIG.lookupUrl, { method: 'POST', headers: commonHeaders, body: body });
        const text = await res.text();
        console.log("Response text length:", text.length);
        if (text.length > 0) {
            console.log("Response:", text.substring(0, 200));
        }
    }
}

testSpecs();
