console.log("[MOT Harvester] Initializing Omnipart Monkey Patch V4");

function extractAuthHeader(headers) {
    if (!headers) return null;
    let auth = null;
    if (headers instanceof Headers) {
        auth = headers.get('Authorization') || headers.get('authorization') || headers.get('Token') || headers.get('token');
    } else if (Array.isArray(headers)) {
        for (let [k, v] of headers) {
            if (k.toLowerCase().includes('auth') || k.toLowerCase().includes('token')) auth = v;
        }
    } else {
        for (let k in headers) {
            if (k.toLowerCase().includes('auth') || k.toLowerCase().includes('token')) auth = headers[k];
        }
    }
    return auth;
}

function processFoundAuth(auth, source) {
    if (auth && typeof auth === 'string' && auth.length > 10) {
        if (!window['_omnipart_harvested_' + source]) {
            window['_omnipart_harvested_' + source] = true;
            console.log("[MOT Harvester] CAUGHT AUTH FROM " + source + "!", auth.substring(0, 30) + "...");
            
            let token = auth;
            if (auth.toLowerCase().startsWith('bearer ')) {
                token = auth.substring(7);
            }
            window.postMessage({ type: 'OMNIPART_TOKEN_INTERCEPT', token: token }, '*');
        }
    }
}

const originalFetch = window.fetch;
window.fetch = async function(...args) {
    try {
        let auth = null;
        if (args[0] instanceof Request) {
            auth = extractAuthHeader(args[0].headers);
            processFoundAuth(auth, 'FETCH_REQ_OBJ');
        }
        if (args[1] && args[1].headers) {
            auth = extractAuthHeader(args[1].headers);
            processFoundAuth(auth, 'FETCH_OPT_OBJ');
        }
    } catch (e) { 
        console.error("[MOT Harvester] error in fetch patch", e);
    }
    return originalFetch.apply(window, args);
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
    if (header.toLowerCase().includes('auth') || header.toLowerCase().includes('token')) {
        processFoundAuth(value, 'XHR_HEADER');
    }
    return originalSetRequestHeader.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function(body) {
    return originalSend.apply(this, arguments);
};
