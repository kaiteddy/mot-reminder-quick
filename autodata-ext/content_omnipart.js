// Inject a script into the main page context to intercept all fetch requests and steal the Bearer token
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject_omnipart.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Listen for the stolen token from the injected script and send it to our backend
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'OMNIPART_TOKEN_INTERCEPT') {
        if (!window._omnipart_sync_sent) {
            window._omnipart_sync_sent = true;
            console.log("Omnipart Extractor caught token! Native Scanner will beam it up.");
            // We NO LONGER POST right here, because we want the Native Background Script
            // to send the full COOKIE_JAR payload instead of just the bare JWT string.
            // But we will still show the alert!
            alert("✨ BINGO! Autodata Extension successfully intercepted your Euro Car Parts Token!\n\nYou can now switch to the MOT App and it will automatically use your live session.");
        }
    }
});

// Listen from background.js
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "TOKEN_CAUGHT") {
        if (!window._omnipart_sync_sent) {
            window._omnipart_sync_sent = true;
            alert("🔒 SECURE INTERCEPT! Autodata Extension bypassed encryption and retrieved your Euro Car Parts Token via Chrome Network Monitoring.\n\nYou can now switch to the MOT App and it will automatically use your live session.");
        }
    }
});

// Since Omnipart hides tokens in HttpOnly cookies, request a deep cookie scan
setInterval(() => {
    if (!window._omnipart_sync_sent) {
        chrome.runtime.sendMessage({ action: "SCAN_OMNIPART" });
    }
}, 3000);
