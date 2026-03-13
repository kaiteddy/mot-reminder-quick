let lastSentToken = "";
let isSyncing = false;

// 1. Listen to outgoing network requests
chrome.webRequest.onSendHeaders.addListener(
  function(details) {
    if (details.requestHeaders) {
      for (let header of details.requestHeaders) {
        if (header.name.toLowerCase() === 'authorization' && header.value.toLowerCase().startsWith('bearer ey')) {
          let token = header.value.substring(7).trim();
          handleFoundToken(token, "Network Header");
        }
      }
    }
  },
  { urls: ["*://*.eurocarparts.com/*"] },
  ["requestHeaders"]
);

// 2. Poll Cookies aggressively
setInterval(() => {
    chrome.cookies.getAll({ domain: "eurocarparts.com" }, function(cookies) {
        for (let c of cookies) {
            if (c.value && c.value.includes('eyJ')) {
                let match = c.value.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
                if (match) {
                    handleFoundToken(match[0], "Cookie Match");
                }
            }
        }
    });

    // 3. Rip LocalStorage directly from active ECP tabs via content script evaluation
    chrome.tabs.query({ url: "*://*.eurocarparts.com/*" }, function(tabs) {
        for (let t of tabs) {
            if (t.id) {
                chrome.scripting.executeScript({
                    target: { tabId: t.id },
                    func: () => {
                        let result = null;
                        for (let i = 0; i < localStorage.length; i++) {
                            const val = localStorage.getItem(localStorage.key(i));
                            if (val && val.includes('eyJ')) {
                                let match = val.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
                                if (match) result = match[0];
                            }
                        }
                        return result;
                    }
                }).then(res => {
                    if (res && res[0] && res[0].result) {
                        handleFoundToken(res[0].result, "LocalStorage Inject");
                    }
                }).catch(err => { /* Ignore blocked frames */ });
            }
        }
    });
}, 3000); // Check every 3 seconds

function handleFoundToken(token, source) {
    if (!token || token.length < 50 || token === lastSentToken) return;

    // Verify it's a TRADE token (contains an email)
    let isTradeToken = false;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.username && payload.username.includes('@') && !payload.guest_user) {
            isTradeToken = true;
        }
    } catch(e) { }

    if (isTradeToken) {
        console.log(`[${source}] Harvested LIVE trade token!`);
        lastSentToken = token;
        sendTokenToLocalApp(token);
    }
}

function sendTokenToLocalApp(token) {
    if (isSyncing) return;
    isSyncing = true;
    
    fetch('http://localhost:3000/api/webhooks/omnipart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
    })
    .then(res => {
        isSyncing = false;
        if (res.ok) {
           const preview = token.substring(0, 20) + '...';
           console.log("Token securely synced to MOT App:", preview);
           
           chrome.storage.local.set({ 
               lastSync: Date.now(), 
               status: 'connected',
               tokenPreview: preview
           });
        } else {
           throw new Error("Local HTTP " + res.status);
        }
    })
    .catch(err => {
        isSyncing = false;
        console.log('Failed to sync. Is your local npm run dev running on port 3000?', err);
        chrome.storage.local.set({ status: 'disconnected' });
        
        // Re-arm so we try again next time we see it
        lastSentToken = "";
    });
}
