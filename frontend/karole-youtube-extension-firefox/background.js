// Relays messages between the Karole player page and the YouTube window it controls.
// Service workers can be stopped at any time, so the window's tab id lives in session storage.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

async function getState() {
    const { youtubeTabId = null, siteTabIds = [], desired = null, lastStatus = null, settings = {} } =
        await browser.storage.session.get(["youtubeTabId", "siteTabIds", "desired", "lastStatus", "settings"]);
    return { youtubeTabId, siteTabIds, desired, lastStatus, settings };
}

async function getYouTubeTab() {
    const { youtubeTabId } = await getState();
    if (youtubeTabId !== null) {
        try {
            return await browser.tabs.get(youtubeTabId);
        } catch {
            // The window was closed; fall through and look for another.
        }
    }
    // Reloading or updating the extension forgets which window it opened, and the scripts in
    // that window stop listening. Take the window over again rather than opening a second one
    // (it gets a fresh page, and so fresh scripts, the next time a song is sent).
    const [adopted] = await browser.tabs.query({ url: "https://www.youtube.com/watch*", windowType: "popup" });
    if (!adopted) return null;
    await browser.storage.session.set({ youtubeTabId: adopted.id, needsFreshPage: true });
    return adopted;
}

function watchUrl(videoId, start) {
    const url = new URL("https://www.youtube.com/watch");
    url.searchParams.set("v", videoId);
    if (start > 0) url.searchParams.set("t", `${Math.floor(start)}s`);
    return url.href;
}

async function tellSites(message) {
    const { siteTabIds } = await getState();
    for (const tabId of siteTabIds) {
        browser.tabs.sendMessage(tabId, message).catch(() => {});
    }
}

async function tellYouTube(message) {
    const tab = await getYouTubeTab();
    if (!tab) return false;
    const { needsFreshPage, desired, lastStatus } = await browser.storage.session.get(["needsFreshPage", "desired", "lastStatus"]);
    try {
        if (needsFreshPage) throw new Error("taken over");
        await browser.tabs.sendMessage(tab.id, message);
    } catch {
        // Nothing is listening in that window (it was taken over, or its page is from before
        // the extension was reloaded): load the song again, from where it was.
        if (desired) {
            const playing = message.type === "play" ? true : message.type === "pause" ? false : desired.playing;
            const start = lastStatus?.videoId === desired.videoId ? lastStatus.time : 0;
            await loadVideo(desired.videoId, playing, start);
        }
    }
    return true;
}

// Opens the YouTube window, or reuses it, and points it at a song.
async function loadVideo(videoId, playing, start) {
    await browser.storage.session.set({ desired: { videoId, playing, start: start || 0 }, needsFreshPage: false });
    const url = watchUrl(videoId, start);
    const tab = await getYouTubeTab();
    if (tab) {
        await browser.tabs.update(tab.id, { url });
        return;
    }
    const window = await browser.windows.create({ url, type: "popup", width: 1280, height: 760 });
    await browser.storage.session.set({ youtubeTabId: window.tabs[0].id });
}

async function fromSite(message, tab) {
    const state = await getState();
    if (!state.siteTabIds.includes(tab.id)) {
        await browser.storage.session.set({ siteTabIds: [...state.siteTabIds, tab.id] });
    }

    switch (message.type) {
        case "load":
            if (!VIDEO_ID.test(message.videoId || "")) return { ok: false, error: "Not a YouTube video id" };
            await loadVideo(message.videoId, Boolean(message.playing), Number(message.start) || 0);
            return { ok: true };
        case "play":
        case "pause": {
            if (state.desired) {
                await browser.storage.session.set({ desired: { ...state.desired, playing: message.type === "play" } });
            }
            return { ok: await tellYouTube({ type: message.type }) };
        }
        case "seek":
            return { ok: await tellYouTube({ type: "seek", time: Number(message.time) || 0 }) };
        case "captions":
            // Only for the song playing now: each video has its own caption tracks.
            return {
                ok: await tellYouTube({
                    type: "captions",
                    captionId: typeof message.captionId === "string" ? message.captionId : null,
                }),
            };
        case "settings": {
            // Volume (0-100), muted, speed and whether YouTube's own controls show. They are
            // kept so every new song gets them too.
            const settings = { ...state.settings };
            if (typeof message.volume === "number") settings.volume = Math.min(100, Math.max(0, message.volume));
            if (typeof message.muted === "boolean") settings.muted = message.muted;
            if (typeof message.rate === "number") settings.rate = Math.min(2, Math.max(0.25, message.rate));
            if (typeof message.showControls === "boolean") settings.showControls = message.showControls;
            await browser.storage.session.set({ settings });
            return { ok: await tellYouTube({ type: "settings", settings }), settings };
        }
        case "fullscreen": {
            const youtubeTab = await getYouTubeTab();
            if (!youtubeTab) return { ok: false };
            const window = await browser.windows.get(youtubeTab.windowId);
            await browser.windows.update(youtubeTab.windowId, {
                state: window.state === "fullscreen" ? "normal" : "fullscreen",
            });
            return { ok: true };
        }
        case "close": {
            const youtubeTab = await getYouTubeTab();
            if (youtubeTab) await browser.windows.remove(youtubeTab.windowId);
            return { ok: true };
        }
        case "status":
            return { ok: true, open: Boolean(await getYouTubeTab()), status: state.lastStatus };
        default:
            return { ok: false, error: `Unknown command ${message.type}` };
    }
}

async function fromYouTube(message, tab) {
    const { youtubeTabId, desired, settings } = await getState();
    const controlled = tab.id === youtubeTabId;
    if (message.type === "hello") {
        // Only the window opened for Karole is taken over; other YouTube tabs are left alone.
        return { controlled, desired: controlled ? desired : null, settings: controlled ? settings : null };
    }
    if (controlled && message.type === "status") {
        // The page can't see its own window, so whether it's full screen is added here.
        const window = await browser.windows.get(tab.windowId).catch(() => null);
        const status = { ...message.status, fullscreen: window?.state === "fullscreen" };
        await browser.storage.session.set({ lastStatus: status });
        await tellSites({ type: "status", status });
    }
    return { ok: true };
}

// Messages are handled one at a time: each reads the stored state and writes it back, so two
// at once (say volume and speed changed together) would overwrite each other's change.
let queue = Promise.resolve();
function oneAtATime(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender.tab) return false;
    const handler = message.from === "youtube" ? fromYouTube : fromSite;
    oneAtATime(() => handler(message, sender.tab))
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true; // the answer is sent asynchronously
});

browser.tabs.onRemoved.addListener(async (tabId) => {
    const { youtubeTabId, siteTabIds } = await getState();
    if (tabId === youtubeTabId) {
        await browser.storage.session.set({ youtubeTabId: null, lastStatus: null });
        await tellSites({ type: "status", status: { state: "closed" } });
    } else if (siteTabIds.includes(tabId)) {
        await browser.storage.session.set({ siteTabIds: siteTabIds.filter((id) => id !== tabId) });
    }
});
