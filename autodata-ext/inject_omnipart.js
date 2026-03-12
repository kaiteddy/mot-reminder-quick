console.log("[MOT Harvester] Initializing Omnipart Monkey Patch V3");

function checkStringForToken(str, source) {
    if (typeof str !== 'string') return;
    if (str.includes('eyJ') && str.length > 50) {
        if (!window['_omnipart_harvested_' + source]) {
            window['_omnipart_harvested_' + source] = true;
            console.log("[MOT Harvester] CAUGHT TOKEN FROM " + source + "!", str.substring(0, 30) + "...");
            
            // Try to extract just the token if it's embedded in JSON or Bearer
            let token = str;
            let match = str.match(/(eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+)/);
            if (match) {
                token = match[1];
            } else if (str.toLowerCase().startsWith('bearer ')) {
                token = str.substring(7);
            }
            
            window.postMessage({ type: 'OMNIPART_TOKEN_INTERCEPT', token: token }, '*');
        }
    }
}

const originalFetch = window.fetch;
window.fetch = async function(...args) {
    try {
        if (args[0] instanceof Request) {
            args[0].headers.forEach((value, key) => {
                checkStringForToken(value, 'FETCH_REQ_HEADER');
            });
            checkStringForToken(args[0].url, 'FETCH_REQ_URL');
        } else if (typeof args[0] === 'string') {
            checkStringForToken(args[0], 'FETCH_URL');
        }
        
        if (args[1]) {
            if (args[1].headers) {
                const h = args[1].headers;
                if (h instanceof Headers) {
                    h.forEach((value, key) => checkStringForToken(value, 'FETCH_OPT_HEADER_OBJ'));
                } else if (Array.isArray(h)) {
                    for (let [key, value] of h) checkStringForToken(value, 'FETCH_OPT_HEADER_ARR');
                } else {
                    for (let key in h) checkStringForToken(h[key], 'FETCH_OPT_HEADER_DICT');
                }
            }
            if (typeof args[1].body === 'string') {
                checkStringForToken(args[1].body, 'FETCH_BODY');
            }
        }
    } catch (e) { 
        console.error("[MOT Harvester] error in fetch patch", e);
    }
    return originalFetch.apply(this, args);
};

const originalOpen = XMLHttpRequest.prototype.open;
const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
const originalSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function() {
    this._requestHeaders = {};
    return originalOpen.apply(this, arguments);
};

XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    this._requestHeaders[header] = value;
    checkStringForToken(value, 'XHR_HEADER');
    return originalSetRequestHeader.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function(body) {
    if (typeof body === 'string') {
        checkStringForToken(body, 'XHR_BODY');
    }
    return originalSend.apply(this, arguments);
};

// Also proactively check localStorage in case they saved it securely there
setInterval(() => {
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const val = localStorage.getItem(key) || "";
            checkStringForToken(val, 'LOCALSTORAGE');
        }
        
        // Sometimes it's stored in sessionStorage
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            const val = sessionStorage.getItem(key) || "";
            checkStringForToken(val, 'SESSIONSTORAGE');
        }

        // Check cookies
        const cookies = document.cookie.split(';');
        for (let c of cookies) {
            checkStringForToken(c, 'COOKIE');
        }
    } catch (e) {}
}, 2000);
