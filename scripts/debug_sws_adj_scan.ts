import "dotenv/config";

const SWS_CONFIG = {
    apiKey: "C94A0F3F12E88DB916C008B069E34F65",
    authHeader: 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
    lookupUrl: 'https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php'
};

async function testV4_Adjustments() {
    const vrm = "YM14NFL";
    const commonHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': SWS_CONFIG.authHeader,
        'User-Agent': 'Garage Assistant/4.0'
    };

    const body = {
        APIKey: SWS_CONFIG.apiKey,
        ACTION: "GET_ADJUSTMENTS",
        VRM: vrm
    };

    const res = await fetch(SWS_CONFIG.lookupUrl, {
        method: 'POST',
        headers: commonHeaders,
        body: new URLSearchParams(body)
    });
    const text = await res.text();
    const data = JSON.parse(text);
    const adjustments = data?.[0]?.TechnicalData?.ExtAdjustment || [];

    console.log("--- SCANNING FOR QUANTITIES/CAPACITIES ---");

    adjustments.forEach((group: any) => {
        console.log(`\n Group: ${group.name}`);
        const items = group.subAdjustments?.item || [];
        const flatItems = Array.isArray(items) ? items : [items];

        flatItems.forEach((item: any) => {
            if (item.name?.toLowerCase().includes("capacity") || item.name?.toLowerCase().includes("quantity")) {
                console.log(`  - ${item.name}: ${item.value} ${item.unit || ''}`);
            }
        });
    });
}

testV4_Adjustments();
