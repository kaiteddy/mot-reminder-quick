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
const DRONE_API_BASE = "https://mot-reminder-quick.vercel.app";
const DRONE_SECRET_STORAGE_KEY = "autodataDroneSecret";
let isPolling = false;

function getDroneSecret() {
    return new Promise((resolve) => {
        chrome.storage.local.get([DRONE_SECRET_STORAGE_KEY], (items) => {
            resolve(items[DRONE_SECRET_STORAGE_KEY] || "");
        });
    });
}

async function pollForJobs() {
    if (isPolling) return;
    isPolling = true;

    try {
        const droneSecret = await getDroneSecret();
        if (!droneSecret) {
            console.warn("Browser Drone polling is disabled until autodataDroneSecret is set in chrome.storage.local.");
            return;
        }

        const res = await fetch(`${DRONE_API_BASE}/api/webhooks/autodata/poll`, {
            headers: {
                "x-autodata-drone-secret": droneSecret
            }
        });
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
    const droneSecret = await getDroneSecret();

    try {
        // We do a Native Fetch directly to Autodata!
        // The background script naturally attaches all its God-mode HttpOnly cookies automatically.
        const url = "https://workshop.autodata-group.com" + job.endpoint;
        console.log("Drone executing fetch:", url);

        const headers = {
            "accept": "application/json, text/html, */*"
        };

        // Only send XHR header if it is an API request, otherwise standard HTML 302 redirects fail
        if (job.isApi !== false && (job.endpoint.includes('/api/') || job.endpoint.includes('/lubricants'))) {
            headers["xhr-request-from"] = "workshop";
        }

        const res = await fetch(url, { headers });

        const contentType = res.headers.get("content-type") || "";
        const rawText = await res.text();

        if (!res.ok) {
            throw new Error(`Autodata returned status: ${res.status}. Body: ${rawText.substring(0, 100)}`);
        }

        try {
            resultData = JSON.parse(rawText);
            console.log("Drone successfully fetched JSON from Autodata!");
        } catch (e) {
            console.log("Drone received non-JSON response from Autodata, sending as raw text.");
            resultData = { rawHtml: rawText, contentType };
        }
    } catch (e) {
        console.error("Drone failed to execute job:", e);
        errorMessage = e.message;
    }

    // Submit the result back to Vercel
    try {
        await fetch(`${DRONE_API_BASE}/api/webhooks/autodata/result`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-autodata-drone-secret": droneSecret
            },
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

// Chrome enforces a minimum 30-second alarm interval.
chrome.alarms.create("dronePoll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "dronePoll") {
        pollForJobs();
    }
});

// Run once immediately on startup
pollForJobs();
