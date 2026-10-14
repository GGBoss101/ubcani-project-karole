// Turns any kind of YouTube video link into the plain form the backend accepts,
// https://www.youtube.com/watch?v=<id>. The backend only recognises a few link shapes
// and at most 100 characters, so share links with tracking parameters, Shorts, mobile
// and YouTube Music links would otherwise be rejected.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
]);
// Paths where the video ID is the next part, e.g. /shorts/<id>.
const ID_PATHS = new Set(["shorts", "embed", "live", "v", "e"]);

// Returns { url } with the cleaned link, or { error } with a message for the person.
export function normalizeYouTubeUrl(input) {
    const text = input.trim();
    if (!text) {
        return { error: "Paste a YouTube link." };
    }

    let url;
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        return { error: "That doesn't look like a link. Copy it from the Share button on YouTube." };
    }

    const host = url.hostname.toLowerCase();
    let id = null;
    if (host === "youtu.be" || host === "www.youtu.be") {
        id = url.pathname.split("/")[1];
    } else if (YOUTUBE_HOSTS.has(host)) {
        const [first, second] = url.pathname.split("/").filter(Boolean);
        if (first === "watch") {
            id = url.searchParams.get("v");
        } else if (ID_PATHS.has(first)) {
            id = second;
        } else if (first === "playlist") {
            return { error: "That's a playlist link. Open the song you want and share that video instead." };
        }
    } else {
        return { error: "Only YouTube links can be added." };
    }

    if (!id || !VIDEO_ID.test(id)) {
        return { error: "That YouTube link doesn't point to a video. Open the video and use its Share link." };
    }
    return { url: `https://www.youtube.com/watch?v=${id}` };
}

// YouTube's own thumbnail for a song from the backend (320 x 180), or null without a video id.
export function thumbnailUrl(song) {
    let id = song?.url_id;
    if (!id) {
        try {
            id = new URL(song?.url).searchParams.get("v");
        } catch {
            id = null;
        }
    }
    return id && VIDEO_ID.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}
