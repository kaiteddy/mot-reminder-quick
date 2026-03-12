chrome.webRequest.onSendHeaders.addListener(
    (details) => {
        if (!details.requestHeaders) return;
        for (let header of details.requestHeaders) {
            if (header.name.toLowerCase() === 'authorization' && header.value.toLowerCase().includes('eyj')) {
                console.log("Omnipart Token Intercepted!", header.value.substring(0, 15) + "...");
                
                if (details.tabId >= 0) {
                    chrome.tabs.sendMessage(details.tabId, { action: "TOKEN_CAUGHT" }).catch(() => {});
                }

                fetch("https://mot-reminder-quick.vercel.app/api/webhooks/omnipart", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token: header.value.trim() })
                }).catch(() => {});
                break;
            }
        }
    },
    { urls: ["*://*.eurocarparts.com/*", "*://*.omnipart.com/*"] },
    ["requestHeaders", "extraHeaders"]
);

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
        if (job.isApi !== false && (job.endpoint.includes('/api/') || job.endpoint.includes('/lubricants') || job.endpoint.includes('/w1/'))) {
            headers["xhr-request-from"] = "workshop";
        }

        let retries = 3;
        while (retries > 0) {
            try {
                const res = await fetch(url, { headers });

                const contentType = res.headers.get("content-type") || "";
                const rawText = await res.text();

                if (!res.ok) {
                    if ((res.status >= 500 || res.status === 408 || res.status === 429) && retries > 1) {
                        console.warn(`Autodata returned ${res.status}. Retrying... (${retries - 1} left)`);
                        retries--;
                        await new Promise(r => setTimeout(r, 2000));
                        continue;
                    }
                    throw new Error(`Autodata returned status: ${res.status} on final attempt. Body: ${rawText.substring(0, 100)}`);
                }

                try {
                    resultData = JSON.parse(rawText);
                    console.log("Drone successfully fetched JSON from Autodata!");
                } catch (e) {
                    console.log("Drone received non-JSON response from Autodata, sending as raw text.");
                    resultData = { rawHtml: rawText, contentType };
                }
                break; // Success, break out of retry loop
            } catch (err) {
                if (retries > 1 && err.message !== "Manual abort" && !err.message.includes("Autodata returned status: 4")) {
                    console.warn(`Fetch error: ${err.message}. Retrying... (${retries - 1} left)`);
                    retries--;
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                throw err;
            }
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

let loopRunning = false;

async function startPollingLoop() {
    if (loopRunning) return;
    loopRunning = true;

    while (true) {
        try {
            await pollForJobs();
        } catch (e) {
            console.error("Error in polling loop:", e);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}

// Chrome enforces a minimum 1-minute alarm interval for Service Workers.
// We use this strictly as a heartbeat to resurrect the service worker if Chrome kills it after 5 minutes.
chrome.alarms.create("dronePollHeartbeat", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "dronePollHeartbeat") {
        console.log("Heartbeat alarm fired. Ensuring polling loop is running.");
        startPollingLoop();
    }
});

// Start aggressive 2-second polling loop immediately on startup or wake
startPollingLoop();
