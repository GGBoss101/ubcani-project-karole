// Runs inside YouTube's own page (the "MAIN" world), because YouTube's player controls
// (#movie_player.playVideo, pauseVideo, seekTo, setVolume, setPlaybackRate, captions...)
// only exist there.
// Setting the <video> element's time directly makes YouTube's player stall, so jumps must go
// through seekTo. youtube-player.js, which talks to the extension, sends commands here and
// reads the reports through window messages. Nothing happens until it says "start", so other
// YouTube tabs are left alone.

let reporting = false;
const player = () => document.getElementById("movie_player");

// A song the Karole window should open paused ("Start each song paused") has karole=paused in its
// address, read here before YouTube's player even exists. Until a real Play arrives from the
// site, the song's video isn't allowed to start at all: its play() is refused the way a browser
// refuses autoplay, which YouTube already handles by sitting at 0:00, paused and silent. Ads are
// left to play; the song after them is held the same way. Other YouTube tabs never have the marker.
let hold = false;
let holdVideoId = null; // the video the hold was read for

const urlVideoId = () => new URLSearchParams(window.location.search).get("v");

function readHold() {
    holdVideoId = urlVideoId();
    hold = new URLSearchParams(window.location.search).get("karole") === "paused";
}
readHold();
// YouTube can change pages without reloading. Only a different video changes the hold, so YouTube
// tidying the address (and dropping karole=paused) can't release it early.
window.addEventListener("yt-navigate-finish", () => {
    if (urlVideoId() !== holdVideoId) readHold();
});

// Only the song itself is held: anything that might be an ad, or can't be told apart yet, plays.
function isHeldSong(video) {
    if (!hold || !(video instanceof HTMLVideoElement)) return false;
    const element = player();
    if (!element || element.classList.contains("ad-showing") || element.classList.contains("ad-interrupting")) return false;
    const playingId = element.getVideoData?.()?.video_id;
    return Boolean(playingId) && playingId === urlVideoId();
}

const nativePlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function play(...args) {
    if (isHeldSong(this)) return Promise.reject(new DOMException("Held by Karole until Play", "NotAllowedError"));
    return nativePlay.apply(this, args);
};

// Backup, should a start get past the above: stop the video the instant it starts, in the capture
// phase of its "play" event, muted until that pause has taken effect.
document.addEventListener("play", (event) => {
    const video = event.target;
    if (!isHeldSong(video)) return;
    const wasMuted = video.muted;
    video.muted = true;
    video.pause();
    player()?.pauseVideo?.();
    video.addEventListener("pause", () => {
        video.muted = wasMuted;
    }, { once: true });
}, true);

function shownCaption(element) {
    try {
        const track = element.getOption("captions", "track");
        return track?.languageCode ? track : null;
    } catch {
        return null;
    }
}

// The caption tracks this video has. They're read from the video's details rather than the
// player's captions module, which only lists them once captions have been turned on. YouTube
// can also show a track that isn't in that list (a remembered language, auto-translated), so
// the one showing is added when it's missing.
function captionTracks(element) {
    const tracks = (element.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).map(
        (track) => ({
            id: track.vssId,
            languageCode: track.languageCode,
            kind: track.kind || null,
            name: track.name?.simpleText || track.name?.runs?.map((run) => run.text).join("") || track.languageCode,
        })
    );
    const shown = shownCaption(element);
    if (shown?.vss_id && !tracks.some((track) => track.id === shown.vss_id)) {
        tracks.push({
            id: shown.vss_id,
            languageCode: shown.languageCode,
            kind: shown.kind || null,
            name: shown.displayName || shown.languageName || shown.languageCode,
        });
    }
    return tracks;
}

// The id of the caption track showing now, or null when captions are off.
function currentCaption(element) {
    const shown = shownCaption(element);
    if (!shown) return null;
    return shown.vss_id || captionTracks(element).find((track) => track.languageCode === shown.languageCode)?.id || null;
}

function setCaption(element, id) {
    const track = id && captionTracks(element).find((each) => each.id === id);
    try {
        if (!track) {
            element.setOption("captions", "track", {});
            element.unloadModule("captions");
            return;
        }
        element.loadModule("captions");
        element.setOption("captions", "track", {
            languageCode: track.languageCode,
            ...(track.kind ? { kind: track.kind } : {}),
        });
    } catch {
        // YouTube's player changed how captions work; the next report shows what's on.
    }
}

function report() {
    const element = player();
    if (!element?.getPlayerState) return;
    window.postMessage(
        {
            source: "karole-player",
            state: element.getPlayerState(),
            time: element.getCurrentTime(),
            duration: element.getDuration(),
            videoId: element.getVideoData?.().video_id || null,
            ad: element.classList.contains("ad-showing"),
            volume: element.getVolume(),
            muted: element.isMuted(),
            rate: element.getPlaybackRate(),
            rates: element.getAvailablePlaybackRates?.() || [],
            captions: captionTracks(element),
            caption: currentCaption(element),
        },
        window.location.origin
    );
}

window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "karole-control") return;
    const { command, time } = event.data;
    // A real Play from the site ends the hold for this song.
    if (command === "play") hold = false;
    if (command === "start" && !reporting) {
        reporting = true;
        window.setInterval(report, 500);
        return;
    }
    const element = player();
    if (!element?.getPlayerState) return;
    if (command === "play") element.playVideo();
    else if (command === "pause") element.pauseVideo();
    else if (command === "seek") element.seekTo(Math.max(0, Number(time) || 0), true);
    else if (command === "volume") element.setVolume(Math.min(100, Math.max(0, Number(event.data.volume) || 0)));
    else if (command === "mute") element.mute();
    else if (command === "unmute") element.unMute();
    else if (command === "rate") element.setPlaybackRate(Number(event.data.rate) || 1);
    else if (command === "captions") setCaption(element, event.data.captionId);
    report();
});
