// Runs inside YouTube's own page (the "MAIN" world), because YouTube's player controls
// (#movie_player.playVideo, pauseVideo, seekTo, setVolume, setPlaybackRate, getPlayerState...)
// only exist there.
// Setting the <video> element's time directly makes YouTube's player stall, so jumps must go
// through seekTo. youtube-player.js, which talks to the extension, sends commands here and
// reads the reports through window messages. Nothing happens until it says "start", so other
// YouTube tabs are left alone.

let reporting = false;
const player = () => document.getElementById("movie_player");

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
        },
        window.location.origin
    );
}

window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "karole-control") return;
    const { command, time } = event.data;
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
    report();
});
