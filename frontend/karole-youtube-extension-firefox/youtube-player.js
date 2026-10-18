// Runs on youtube.com. In the window the Karole player opened (and only there), it makes the
// video fill the window, carries out the commands from the player page (play, pause, jump,
// volume, speed, captions, showing YouTube's own controls), and reports what the video is doing so the
// player page can move on when a song ends.
// YouTube's player itself is driven through youtube-main.js (see there for why).

// YouTube's player states: -1 not started, 0 ended, 1 playing, 2 paused, 3 buffering, 5 ready.
const STATES = { "-1": "loading", 0: "ended", 1: "playing", 2: "paused", 3: "loading", 5: "paused" };

let controlled = false;
let desired = null; // { videoId, playing } from the player page
let settings = {}; // { volume, muted, rate, showControls } from the player page
let appliedFor = null; // which video the wanted play/pause state was last applied to
let volumeAppliedFor = null; // which video the volume was last applied to
let rateAppliedFor = null; // which video the speed was last applied to
let player = null; // latest report from youtube-main.js
let lastReport = "";
let lastReportAt = 0;

const currentVideoId = () => new URLSearchParams(window.location.search).get("v");

function command(name, extra = {}) {
    window.postMessage({ source: "karole-control", command: name, ...extra }, window.location.origin);
}

// The message YouTube shows instead of the video ("Video unavailable", "Sign in to confirm
// your age", ...), if any.
function errorText() {
    const overlay = document.querySelector(".ytp-error .ytp-error-content-wrap-reason");
    const page = document.querySelector("yt-playability-error-supported-renderers:not([hidden]) #reason");
    const visible = overlay && overlay.offsetParent !== null ? overlay : page;
    return visible?.textContent.trim() || null;
}

function addKioskStyle() {
    if (document.getElementById("karole-kiosk")) return;
    const style = document.createElement("style");
    style.id = "karole-kiosk";
    // Only the video is shown, filling the window, like a TV. YouTube sizes the video and its
    // container itself for the normal page, so both are pinned to the window here; sizing only
    // the video left its container 0 px tall and the picture black. YouTube's own controls are
    // hidden unless the player page turns them on (the "karole-controls" class). Captions start
    // at the bottom centre (YouTube left-aligns auto-generated ones) and can be dragged from there
    // (see enableCaptionDrag).
    style.textContent = `
        html, body { overflow: hidden !important; background: #000 !important; }
        #masthead-container, #secondary, #below, #chat, ytd-mini-guide-renderer, tp-yt-app-drawer,
        ytd-popup-container, .ytp-ce-element, .ytp-pause-overlay { display: none !important; }
        html:not(.karole-controls) :is(.ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top,
            .ytp-gradient-bottom) { display: none !important; }
        #movie_player { position: fixed !important; inset: 0 !important; width: 100vw !important;
            height: 100vh !important; z-index: 2147483647 !important; background: #000 !important; }
        #movie_player .html5-video-container { position: absolute !important; inset: 0 !important;
            width: 100% !important; height: 100% !important; }
        #movie_player video.html5-main-video { position: absolute !important; inset: 0 !important;
            width: 100% !important; height: 100% !important; object-fit: contain !important; }
        #movie_player .ytp-caption-window-container { position: absolute !important; inset: 0 !important;
            width: 100% !important; height: 100% !important; }
        #movie_player .caption-window.ytp-caption-window-bottom { top: auto !important;
            bottom: 6% !important; left: 50% !important; right: auto !important; margin-left: 0 !important;
            width: max-content !important; max-width: 90% !important; text-align: center !important;
            transform: translate(calc(-50% + var(--karole-caption-x, 0px)), var(--karole-caption-y, 0px)) !important;
            cursor: move !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function showYouTubeControls(show) {
    const root = document.documentElement;
    if (root.classList.contains("karole-controls") === Boolean(show)) return;
    root.classList.toggle("karole-controls", Boolean(show));
    // YouTube lays its control bar out for the player's size when it's measured; nudge it to
    // measure again now that the player fills the window.
    window.dispatchEvent(new Event("resize"));
}

// Captions can be dragged anywhere in the window and double-clicked to go back to the centre.
// The spot is kept in sessionStorage, which lasts while this window stays open, so each new song
// (a fresh page) puts them back where they were. The listeners run before YouTube's own, so its
// caption drag and its double-click full screen don't also fire.
const CAPTION_OFFSET_KEY = "karole-caption-offset";
let captionDragEnabled = false;

function setCaptionOffset(x, y) {
    const root = document.documentElement;
    root.style.setProperty("--karole-caption-x", `${x}px`);
    root.style.setProperty("--karole-caption-y", `${y}px`);
    try {
        sessionStorage.setItem(CAPTION_OFFSET_KEY, JSON.stringify({ x, y }));
    } catch {
        // Not kept for the next song; the captions start at the centre again.
    }
}

function enableCaptionDrag() {
    if (captionDragEnabled) return;
    captionDragEnabled = true;
    try {
        const saved = JSON.parse(sessionStorage.getItem(CAPTION_OFFSET_KEY) || "null");
        if (saved) setCaptionOffset(Number(saved.x) || 0, Number(saved.y) || 0);
    } catch {
        // Starts at the centre.
    }

    let drag = null;
    const onCaption = (event) => event.target instanceof Element && event.target.closest(".caption-window");
    const stop = (event) => {
        event.stopPropagation();
        event.preventDefault();
    };

    window.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !onCaption(event)) return;
        stop(event);
        const style = document.documentElement.style;
        drag = {
            startX: event.clientX,
            startY: event.clientY,
            x: parseFloat(style.getPropertyValue("--karole-caption-x")) || 0,
            y: parseFloat(style.getPropertyValue("--karole-caption-y")) || 0,
        };
    }, true);
    window.addEventListener("mousedown", (event) => {
        if (onCaption(event)) stop(event);
    }, true);
    window.addEventListener("pointermove", (event) => {
        if (!drag) return;
        stop(event);
        // Kept within the window so they can't be dragged out of sight.
        const halfWidth = window.innerWidth / 2;
        const x = Math.max(-halfWidth, Math.min(halfWidth, drag.x + event.clientX - drag.startX));
        const y = Math.max(-window.innerHeight * 0.9, Math.min(0, drag.y + event.clientY - drag.startY));
        setCaptionOffset(Math.round(x), Math.round(y));
    }, true);
    window.addEventListener("pointerup", (event) => {
        if (!drag) return;
        stop(event);
        drag = null;
    }, true);
    window.addEventListener("click", (event) => {
        // A click on the captions would otherwise pause the video.
        if (onCaption(event)) stop(event);
    }, true);
    window.addEventListener("dblclick", (event) => {
        if (!onCaption(event)) return;
        stop(event);
        setCaptionOffset(0, 0);
    }, true);
}

// YouTube plays a recommended video when one ends; the player page decides what's next.
function turnOffAutoplayNext() {
    const toggle = document.querySelector(".ytp-autonav-toggle-button[aria-checked='true']");
    if (toggle) toggle.click();
}

function status() {
    const error = errorText();
    const fresh = player && player.videoId === currentVideoId();
    return {
        videoId: currentVideoId(),
        state: error ? "error" : fresh ? STATES[player.state] || "loading" : "loading",
        ad: Boolean(fresh && player.ad),
        time: fresh ? Math.round(player.time * 10) / 10 : 0,
        duration: fresh && player.duration > 0 && !player.ad ? Math.round(player.duration) : null,
        volume: player ? player.volume : null,
        muted: player ? player.muted : null,
        rate: player ? player.rate : null,
        rates: player ? player.rates : null,
        // Caption tracks of this video, and the id of the one showing (null when off).
        captions: fresh ? player.captions || [] : [],
        caption: fresh ? player.caption || null : null,
        showControls: document.documentElement.classList.contains("karole-controls"),
        error,
    };
}

// Sends what the video is doing whenever it changes, and at least every 2 seconds so the
// player page can tell the window is still there.
function report(force = false) {
    const current = status();
    const key = JSON.stringify(current);
    if (!force && key === lastReport && Date.now() - lastReportAt < 2000) return;
    lastReport = key;
    lastReportAt = Date.now();
    browser.runtime.sendMessage({ from: "youtube", type: "status", status: current }).catch(() => {});
}

function applyVolume() {
    if (typeof settings.volume === "number") command("volume", { volume: settings.volume });
    if (typeof settings.muted === "boolean") command(settings.muted ? "mute" : "unmute");
}

function applyRate() {
    if (typeof settings.rate === "number") command("rate", { rate: settings.rate });
}

// Makes the video match what the player page wants once per song: the chosen volume (straight
// away, so an ad before the song isn't louder), the speed (YouTube resets it for each video;
// ads always play at normal speed) and playing or paused.
function applyDesired(current) {
    if (player && volumeAppliedFor !== current.videoId) {
        volumeAppliedFor = current.videoId;
        applyVolume();
    }
    if (current.ad || !["playing", "paused"].includes(current.state)) return;
    if (rateAppliedFor !== current.videoId) {
        rateAppliedFor = current.videoId;
        applyRate();
    }
    if (!desired || current.videoId !== desired.videoId || appliedFor === desired.videoId) return;
    appliedFor = desired.videoId;
    command(desired.playing ? "play" : "pause");
}

function tick() {
    addKioskStyle();
    showYouTubeControls(settings.showControls);
    turnOffAutoplayNext();
    applyDesired(status());
    report();
}

function takeControl(reply) {
    controlled = Boolean(reply?.controlled);
    desired = reply?.desired || desired;
    settings = reply?.settings || settings;
    if (!controlled) return;
    addKioskStyle();
    enableCaptionDrag();
    command("start");
}

window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "karole-player") return;
    player = event.data;
    if (controlled) tick();
});

browser.runtime.onMessage.addListener((message) => {
    if (!controlled) return;
    if (message.type === "play" || message.type === "pause") {
        if (desired) desired.playing = message.type === "play";
        command(message.type);
    } else if (message.type === "seek") {
        command("seek", { time: message.time });
    } else if (message.type === "captions") {
        command("captions", { captionId: message.captionId });
        // YouTube lays captions out for the player's size when they appear; nudge it to measure
        // again once they've loaded.
        window.setTimeout(() => window.dispatchEvent(new Event("resize")), 600);
    } else if (message.type === "settings") {
        settings = message.settings || {};
        showYouTubeControls(settings.showControls);
        applyVolume();
        if (!status().ad) applyRate();
    }
});

browser.runtime.sendMessage({ from: "youtube", type: "hello" }).then(takeControl).catch(() => {});

// YouTube changes pages without reloading; a new song means applying the wanted state again.
window.addEventListener("yt-navigate-finish", () => {
    appliedFor = null;
    volumeAppliedFor = null;
    rateAppliedFor = null;
    browser.runtime.sendMessage({ from: "youtube", type: "hello" }).then(takeControl).catch(() => {});
});
