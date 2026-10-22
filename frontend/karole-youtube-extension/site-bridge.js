// Runs on the Karole site. The player page can't talk to an extension directly, so it posts
// window messages ({ source: "karole-page", message }) and this script passes them on, and
// passes the extension's answers and status updates back the same way.

function toPage(message) {
    window.postMessage({ source: "karole-extension", message }, window.location.origin);
}

window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "karole-page") return;
    const message = event.data.message || {};
    if (message.type === "ping") {
        // With this browser's device ID, for the "main screen" (see background.js getDeviceId).
        const version = chrome.runtime.getManifest().version;
        chrome.runtime
            .sendMessage({ from: "site", type: "device-id" })
            .then((reply) => toPage({ type: "installed", version, deviceId: reply?.deviceId || null }))
            .catch(() => toPage({ type: "installed", version, deviceId: null }));
        return;
    }
    chrome.runtime
        .sendMessage({ ...message, from: "site" })
        .then((reply) => toPage({ type: "reply", id: message.id, reply }))
        .catch((error) => toPage({ type: "reply", id: message.id, reply: { ok: false, error: error.message } }));
});

chrome.runtime.onMessage.addListener((message) => {
    toPage(message);
});
