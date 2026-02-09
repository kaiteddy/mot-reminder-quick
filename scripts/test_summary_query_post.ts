async function testSummaryQueryPost() {
    console.log("Testing Summary Post on TechnicalData_Query.php...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";

    const body = new URLSearchParams();
    body.append('APIKey', apiKey);
    body.append('ACTION', 'SPECS');
    body.append('VRM', vrm);

    const response = await fetch("https://www.sws-solutions.co.uk/API-V4/TechnicalData_Module.php", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'Garage Assistant/4.0'
        },
        body: body
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Length:", text.length);
    console.log("Text:", text.substring(0, 1000));
}

testSummaryQueryPost().catch(console.error);
