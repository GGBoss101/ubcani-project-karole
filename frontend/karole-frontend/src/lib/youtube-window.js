// Talks to the "Karole YouTube Controller" Chrome extension (frontend/karole-youtube-extension),
// which opens real YouTube in its own window and plays songs there. A page can't call an
// extension directly, so messages go through window.postMessage and the extension's script
// on this site passes them on.

const FROM_PAGE = "karole-page";
const FROM_EXTENSION = "karole-extension";

// Calls `onMessage` with every message from the extension. Returns a function that stops.
export function listenToExtension(onMessage) {
    function handle(event) {
        if (event.source !== window || event.data?.source !== FROM_EXTENSION) return;
        onMessage(event.data.message || {});
    }
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
}

export function sendToExtension(message) {
    window.postMessage({ source: FROM_PAGE, message }, window.location.origin);
}

// Resolves with the extension's version, or null when it isn't installed on this browser.
export function detectExtension(timeoutMs = 800) {
    return new Promise((resolve) => {
        const stop = listenToExtension((message) => {
            if (message.type !== "installed") return;
            clearTimeout(timer);
            stop();
            resolve(message.version || "unknown");
        });
        const timer = setTimeout(() => {
            stop();
            resolve(null);
        }, timeoutMs);
        sendToExtension({ type: "ping" });
    });
}

// The YouTube video id of a song from the backend.
export function videoIdOf(song) {
    if (song?.url_id) return song.url_id;
    try {
        return new URL(song?.url).searchParams.get("v");
    } catch {
        return null;
    }
}
