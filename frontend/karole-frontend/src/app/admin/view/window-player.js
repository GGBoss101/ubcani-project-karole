"use client";

import { useEffect, useRef, useState } from "react";
import { detectExtension, listenToExtension, sendToExtension, videoIdOf } from "../../../lib/youtube-window";
import { startTicker } from "../../../lib/background-ticker";
import { formatLength } from "../../../lib/queue-time";
import AutoPlayDelay from "../../../components/auto-play-delay";
import styles from "./page.module.css";

const STATE_LABELS = {
    loading: "Loading",
    playing: "Playing",
    paused: "Paused",
    ended: "Finished",
    error: "Can't play",
    closed: "Window closed",
};
// YouTube's usual speeds, used until the window reports the ones this video offers.
const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Plays songs in a real YouTube window through the Karole YouTube Controller extension.
// This page becomes the remote: every control for the screen is here (play/pause, back, skip,
// jump, volume, speed, captions, full screen, YouTube's own controls). When a song ends, the
// extension moves the queue on itself (from 1.6.0, `extensionAdvances`), so that happens even
// while this page is asleep in a background tab; this page only does it if the extension couldn't
// reach the backend, or for an older extension.
export default function WindowPlayer({
    song,
    playing,
    onEnded,
    extensionAdvances,
    pauseBeforeSongs,
    settingsLoaded,
    onTogglePauseBeforeSongs,
    autoPlay,
    onToggleAutoPlay,
    autoPlaySeconds,
    onSaveAutoPlaySeconds,
    onPlayPause,
    onBack,
    onSkip,
}) {
    const [status, setStatus] = useState(null);
    const [seekTo, setSeekTo] = useState(null);
    const [volumeDraft, setVolumeDraft] = useState(null);
    // When the YouTube window last reported in; it does so at least every 2 seconds.
    const [lastHeard, setLastHeard] = useState(0);
    const [now, setNow] = useState(0);
    const endedFor = useRef(null);
    const loadedFor = useRef(null);
    const lastCorrection = useRef(0);
    const mismatchSince = useRef(null);
    const videoId = videoIdOf(song);

    // The newest song the extension couldn't move on from by itself.
    const [endedUnhandled, setEndedUnhandled] = useState(null);

    useEffect(() => listenToExtension((message) => {
        if (message.type === "status") {
            setStatus(message.status);
            setLastHeard(Date.now());
        }
        if (message.type === "song-ended" && !message.handled) setEndedUnhandled(message.pId);
    }), []);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 2000);
        return () => window.clearInterval(timer);
    }, []);

    // Asks the window how it's doing every 2 seconds rather than only waiting to hear from it:
    // while it's hidden (minimized or covered) and quiet, the browser slows its own report timer
    // to as little as once a minute, but it still answers when asked (extension 1.7.5). A worker
    // ticker, so this keeps going while this page is in a background tab.
    useEffect(() => startTicker(() => sendToExtension({ type: "status" }), 2000), []);

    // A new song (or none): point the YouTube window at it.
    useEffect(() => {
        if (!song || !videoId) {
            sendToExtension({ type: "pause" });
            return;
        }
        if (loadedFor.current === song.p_id) return;
        loadedFor.current = song.p_id;
        endedFor.current = null;
        setStatus(null);
        // Give the window time to load the song before calling it unresponsive.
        setLastHeard(Date.now());
        lastCorrection.current = Date.now();
        sendToExtension({ type: "load", videoId, pId: song.p_id, playing });
        // `playing` is sent with the song; later changes are handled by the effect below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [song?.p_id, videoId]);

    // Play and pause from here or the admin pages.
    const hasSong = Boolean(song);
    useEffect(() => {
        if (!hasSong) return;
        sendToExtension({ type: playing ? "play" : "pause" });
    }, [playing, hasSong]);

    // The song finished in the YouTube window (not an ad before it): go to the next one, unless
    // the extension does that itself.
    useEffect(() => {
        if (!song || extensionAdvances || !status || status.videoId !== videoId || status.ad) return;
        if (status.state === "ended" && endedFor.current !== song.p_id) {
            endedFor.current = song.p_id;
            onEnded();
        }
    }, [status, song, videoId, onEnded, extensionAdvances]);

    // The extension couldn't reach the backend to move on from this song: do it from here.
    useEffect(() => {
        if (!song || endedUnhandled !== song.p_id || endedFor.current === song.p_id) return;
        endedFor.current = song.p_id;
        onEnded();
    }, [endedUnhandled, song, onEnded]);

    // YouTube moved on to some other video by itself (its "autoplay next", or someone clicked a
    // suggestion in the window): put the queue's song back, or stop if there is none.
    useEffect(() => {
        if (!status?.videoId || status.ad || status.state !== "playing" || status.videoId === videoId) {
            mismatchSince.current = null;
            return;
        }
        // Right after a song is sent, the window still shows the previous one for a moment.
        if (Date.now() - lastCorrection.current < 8000) return;
        // Only once it has lasted a few seconds: this page may have just woken up in a background
        // tab and not yet heard that the extension moved on to the next song, which it hears
        // within half a second.
        mismatchSince.current ??= Date.now();
        if (Date.now() - mismatchSince.current < 3000) return;
        mismatchSince.current = null;
        lastCorrection.current = Date.now();
        if (song && videoId) {
            sendToExtension({ type: "load", videoId, pId: song.p_id, playing });
        } else {
            sendToExtension({ type: "pause" });
        }
    }, [status, song, videoId, playing]);

    const isThisSong = Boolean(song) && status?.videoId === videoId;
    let state = "loading";
    if (status?.state === "closed") state = "closed";
    else if (isThisSong) state = status.ad ? "ad" : status.state;
    const duration = isThisSong ? status.duration : song?.duration;
    const time = seekTo ?? (isThisSong ? status.time : 0);
    const volume = volumeDraft ?? status?.volume ?? 100;
    const muted = Boolean(status?.muted);
    const rate = status?.rate ?? 1;
    const rates = status?.rates?.length ? status.rates : DEFAULT_RATES;
    const slower = [...rates].reverse().find((option) => option < rate);
    const faster = rates.find((option) => option > rate);
    // Caption tracks of the song playing now; each video has its own.
    const captions = isThisSong && !status.ad ? status.captions || [] : [];
    const caption = isThisSong ? status.caption || "" : "";
    const showControls = Boolean(status?.showControls);
    const fullscreen = Boolean(status?.fullscreen);
    // A song is up but the window has gone quiet: it was closed, or it's left over from before
    // the extension was reloaded and no longer listens.
    const silent = Boolean(song) && state !== "closed" && now - lastHeard > 8000;
    // Whether the silence is because the extension was updated or reloaded: this page's link to
    // it then stops answering too, until the page is reloaded.
    const [bridgeGone, setBridgeGone] = useState(false);
    useEffect(() => {
        if (!silent) return;
        let active = true;
        detectExtension().then((version) => {
            if (active) setBridgeGone(!version);
        });
        return () => {
            active = false;
        };
    }, [silent]);
    // The song should be playing but YouTube is sitting still: Chrome only lets a page start
    // with sound after someone clicks in it (see the extension's README for a setting that
    // lifts this on a computer).
    const waiting = Boolean(song) && playing && isThisSong && !status.ad && ["paused", "loading"].includes(status.state);
    const [waitingSince, setWaitingSince] = useState(null);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setWaitingSince(waiting ? Date.now() : null);
    }, [waiting, song?.p_id]);
    const autoplayBlocked = waiting && waitingSince !== null && now - waitingSince > 5000;

    function finishSeek() {
        if (seekTo !== null) sendToExtension({ type: "seek", time: seekTo });
        setSeekTo(null);
    }

    function finishVolume() {
        if (volumeDraft !== null) sendToExtension({ type: "settings", volume: volumeDraft, muted: false });
        setVolumeDraft(null);
    }

    function openWindow() {
        if (!song || !videoId) return;
        loadedFor.current = song.p_id;
        lastCorrection.current = Date.now();
        setLastHeard(Date.now());
        // A deliberate reload, so the window starts the song again even if it already has it.
        sendToExtension({ type: "load", videoId, pId: song.p_id, playing, force: true });
    }

    return (
        <div className={styles.remote}>
            <div className={styles.nowShowing}>
                <p className={styles.remoteState}>
                    {song ? (state === "ad" ? "Ad playing" : STATE_LABELS[state] || state) : "Waiting for the next singer"}
                </p>
                {song && (
                    <>
                        <h1 className={styles.remoteTitle}>{song.youtube_title}</h1>
                        <p className={styles.remoteSinger}>{song.name}</p>
                    </>
                )}
            </div>

            {state === "error" && status?.error && (
                <p className={styles.notice} role="alert">
                    YouTube says: {status.error}. Skip to the next song or try another version of this one.
                </p>
            )}
            {autoplayBlocked && !silent && (
                <p className={styles.notice} role="status">
                    YouTube is waiting to start. Click once on the video in the YouTube window to let it play
                    with sound; later songs usually start on their own.
                </p>
            )}
            {state === "closed" && song && (
                <p className={styles.notice} role="status">The YouTube window was closed. Open it again below.</p>
            )}
            {silent && bridgeGone && (
                <div className={styles.notice} role="alert">
                    <p>The extension was updated. Reload this page, then reopen the YouTube window.</p>
                    <button type="button" className={styles.iconButton} onClick={() => window.location.reload()}>
                        Reload this page
                    </button>
                </div>
            )}
            {silent && !bridgeGone && (
                <div className={styles.notice} role="alert">
                    <p>
                        The YouTube window isn&apos;t responding, so the controls can&apos;t reach it. Reconnect
                        it below; if that doesn&apos;t help, reload this page.
                    </p>
                    <button type="button" className={styles.iconButton} onClick={openWindow}>
                        Reconnect the YouTube window
                    </button>
                </div>
            )}

            <label className={styles.seek}>
                <span>{formatLength(time || 0)}</span>
                <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    step="1"
                    value={Math.min(time || 0, duration || 0)}
                    disabled={!duration || state === "ad"}
                    onChange={(event) => setSeekTo(Number(event.target.value))}
                    onPointerUp={finishSeek}
                    onKeyUp={finishSeek}
                    aria-label="Jump to a point in the song"
                />
                <span>{formatLength(duration || 0)}</span>
            </label>

            <div className={styles.transport}>
                <button type="button" onClick={onBack} aria-label="Previous song">Back</button>
                <button className={styles.transportPlay} type="button" onClick={onPlayPause}>
                    {playing ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={onSkip} aria-label="Next song">Skip</button>
            </div>

            <div className={styles.settings}>
                <div className={styles.setting}>
                    <span className={styles.settingLabel}>Volume</span>
                    <div className={styles.settingRow}>
                        <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => sendToExtension({ type: "settings", muted: !muted })}
                            aria-pressed={muted}
                        >
                            {muted ? "Unmute" : "Mute"}
                        </button>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={muted ? 0 : volume}
                            onChange={(event) => setVolumeDraft(Number(event.target.value))}
                            onPointerUp={finishVolume}
                            onKeyUp={finishVolume}
                            aria-label="Volume"
                        />
                        <span className={styles.settingValue}>{muted ? "Muted" : `${volume}%`}</span>
                    </div>
                </div>

                <div className={styles.setting}>
                    <span className={styles.settingLabel}>Speed</span>
                    <div className={styles.settingRow}>
                        <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => sendToExtension({ type: "settings", rate: slower })}
                            disabled={slower === undefined}
                            aria-label="Slower"
                        >
                            Slower
                        </button>
                        <button
                            type="button"
                            className={styles.rateValue}
                            onClick={() => sendToExtension({ type: "settings", rate: 1 })}
                            title="Back to normal speed"
                        >
                            {rate}×
                        </button>
                        <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => sendToExtension({ type: "settings", rate: faster })}
                            disabled={faster === undefined}
                            aria-label="Faster"
                        >
                            Faster
                        </button>
                    </div>
                </div>

                <label className={styles.setting}>
                    <span className={styles.settingLabel}>Captions</span>
                    <select
                        className={styles.select}
                        value={captions.length ? caption : ""}
                        onChange={(event) => sendToExtension({ type: "captions", captionId: event.target.value || null })}
                        disabled={!captions.length}
                    >
                        <option value="">{captions.length ? "Off" : "No captions for this video"}</option>
                        {captions.map((track) => (
                            <option key={track.id} value={track.id}>{track.name}</option>
                        ))}
                    </select>
                </label>

                <div className={styles.setting}>
                    <span className={styles.settingLabel}>Queue</span>
                    <div className={styles.settingStack}>
                        <div className={styles.settingRow}>
                            <button
                                type="button"
                                role="switch"
                                className={`${styles.iconButton} ${pauseBeforeSongs ? styles.toggleOn : ""}`}
                                onClick={onTogglePauseBeforeSongs}
                                aria-checked={Boolean(pauseBeforeSongs)}
                                disabled={!settingsLoaded}
                            >
                                Start each song paused: {pauseBeforeSongs ? "on" : "off"}
                            </button>
                            <span className={styles.settingHint}>New songs wait at the start until you press Play</span>
                        </div>
                        <div className={styles.settingRow}>
                            <button
                                type="button"
                                role="switch"
                                className={`${styles.iconButton} ${pauseBeforeSongs && autoPlay ? styles.toggleOn : ""}`}
                                onClick={onToggleAutoPlay}
                                aria-checked={Boolean(pauseBeforeSongs && autoPlay)}
                                disabled={!pauseBeforeSongs || !settingsLoaded}
                            >
                                Auto-play after a delay: {pauseBeforeSongs && autoPlay ? "on" : "off"}
                            </button>
                            <AutoPlayDelay
                                seconds={autoPlaySeconds}
                                disabled={!pauseBeforeSongs || !autoPlay || !settingsLoaded}
                                onSave={onSaveAutoPlaySeconds}
                            />
                            <span className={styles.settingHint}>
                                Songs start paused, then play automatically after the set delay. Pressing Play or Pause stops the countdown.
                            </span>
                        </div>
                    </div>
                </div>

                <div className={styles.setting}>
                    <span className={styles.settingLabel}>Screen</span>
                    <div className={styles.settingRow}>
                        <button
                            type="button"
                            className={`${styles.iconButton} ${fullscreen ? styles.toggleOn : ""}`}
                            onClick={() => sendToExtension({ type: "fullscreen" })}
                            aria-pressed={fullscreen}
                        >
                            Full screen: {fullscreen ? "on" : "off"}
                        </button>
                        <button
                            type="button"
                            className={`${styles.iconButton} ${showControls ? "" : styles.toggleOn}`}
                            onClick={() => sendToExtension({ type: "settings", showControls: !showControls })}
                            aria-pressed={showControls}
                        >
                            YouTube controls: {showControls ? "shown" : "hidden"}
                        </button>
                        <button
                            type="button"
                            className={styles.iconButton}
                            onClick={openWindow}
                            disabled={!song || state === "closed"}
                        >
                            Reload video
                        </button>
                        {state === "closed" ? (
                            <button type="button" className={styles.iconButton} onClick={openWindow} disabled={!song}>
                                Open YouTube window
                            </button>
                        ) : (
                            <button
                                type="button"
                                className={styles.iconButton}
                                onClick={() => sendToExtension({ type: "close" })}
                            >
                                Close YouTube window
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
