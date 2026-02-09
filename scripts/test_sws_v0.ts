
async function testV0Style() {
    console.log("Testing V0 Style (No Auth Header)...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";

    const formData = new FormData();
    formData.append('apikey', apiKey);
    formData.append('action', 'summary');
    formData.append('vrm', vrm);

    const response = await fetch("https://www.sws-solutions.co.uk/API-V4/TechnicalData_Module.php", {
        method: 'POST',
        headers: {
            'User-Agent': 'GarageManager-Pro/1.0'
        },
        body: formData
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Text:", text.substring(0, 500));
}

testV0Style().catch(console.error);
