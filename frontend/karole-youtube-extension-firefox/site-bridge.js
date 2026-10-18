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
        toPage({ type: "installed", version: browser.runtime.getManifest().version });
        return;
    }
    browser.runtime
        .sendMessage({ ...message, from: "site" })
        .then((reply) => toPage({ type: "reply", id: message.id, reply }))
        .catch((error) => toPage({ type: "reply", id: message.id, reply: { ok: false, error: error.message } }));
});

browser.runtime.onMessage.addListener((message) => {
    toPage(message);
});
