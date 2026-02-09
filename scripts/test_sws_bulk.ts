
async function testBulkActions() {
    console.log("Testing Bulk Actions on TechnicalData_Query.php...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";
    const actions = ['GET_INITIAL_SUBJECTS', 'LUF', 'LUQ', 'TSB', 'ACG', 'LUB', 'GENARTS', 'REPTIMES', 'SPECS', 'MAINT', 'DIAG'];

    for (const action of actions) {
        const url = `https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php?APIKey=${apiKey}&ACTION=${action}&VRM=${vrm}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
                'User-Agent': 'Garage Assistant/4.0'
            }
        });
        const text = await response.text();
        console.log(`- Action ${action}: Status ${response.status}, Length ${text.length}`);
        if (text.length > 0) {
            console.log(`  Preview: ${text.substring(0, 100)}`);
        }
    }
}

testBulkActions().catch(console.error);
