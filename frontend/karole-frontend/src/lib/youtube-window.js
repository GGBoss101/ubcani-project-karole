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

// Points the YouTube window, if one is already open, at what the backend now says is playing.
// Used after a change made outside the player page (say on the admin Playlist page), so it
// reaches the window even while the player page is asleep in a background tab. It never opens
// a window, and does nothing when the extension isn't installed.
export function steerYouTubeWindow(playback, finished) {
    const song = finished ? null : playback?.song;
    const videoId = videoIdOf(song);
    if (videoId) {
        sendToExtension({ type: "load", videoId, pId: song.p_id, playing: Boolean(playback.playing), onlyIfOpen: true });
    } else {
        sendToExtension({ type: "pause" });
    }
}

// A Skip or Back request that names the song it was pressed on, so a second press for the same
// song (say from another phone a moment later) doesn't move the queue twice.
export function fromSong(path, pId) {
    return Number.isInteger(pId) ? `${path}?from_p_id=${pId}` : path;
}

// Whether the installed extension moves the queue on by itself when a song ends (1.6.0 and later).
export function extensionAdvancesQueue(version) {
    const [major, minor] = String(version || "").split(".").map(Number);
    return major > 1 || (major === 1 && minor >= 6);
}
