"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_URI } from "../../../lib/config";
import { adminFetch } from "../../../lib/admin-auth";
import { statusMessage } from "../../../lib/api-error";
import { fetchQueueFinished } from "../../../lib/use-playlist";
import { detectExtensionInfo, extensionAdvancesQueue, fromSong, sendToExtension } from "../../../lib/youtube-window";
import { claimMainScreen, fetchMainScreen, localDeviceId } from "../../../lib/main-screen";
import { startTicker } from "../../../lib/background-ticker";
import { useQueueSettings } from "../../../lib/use-queue-settings";
import StreamPlayer from "./stream-player";
import WindowPlayer from "./window-player";
import RemotePlayer from "./remote-player";
import styles from "./page.module.css";

export default function AdminView() {
    const [playback, setPlayback] = useState({ playing: false, song: null });
    const [error, setError] = useState("");
    // The extension's { version, deviceId }: undefined while checking, null when it isn't here.
    const [extension, setExtension] = useState(undefined);
    // A phone or tablet, which shows the remote without waiting for the extension check.
    const [touch, setTouch] = useState(false);
    // This browser's own ID, when it has no extension to give one (see lib/main-screen.js).
    const [localId, setLocalId] = useState(null);
    // Which device is the main screen: undefined until known, then { device_id, label }.
    const [mainScreen, setMainScreen] = useState(undefined);
    // The song the YouTube window couldn't play, which the built-in player plays here instead.
    const [fallbackFor, setFallbackFor] = useState(null);
    // Goes up with every button press. A status check that was already on its way when a button
    // was pressed may carry the state from before it (over a slow link it can arrive after the
    // press is done), so its answer is ignored rather than undoing the press.
    const controlCount = useRef(0);
    const controlSequence = useRef(0);
    const controlQueue = useRef(Promise.resolve());

    useEffect(() => {
        Promise.resolve().then(() => {
            setTouch(Boolean(window.matchMedia?.("(pointer: coarse)").matches));
            setLocalId(localDeviceId());
        });
        detectExtensionInfo().then(setExtension);
    }, []);

    // Which device is the main screen, checked every 3 seconds: when another device takes over,
    // this one stops playing and becomes a remote within a few seconds.
    useEffect(() => {
        let isActive = true;
        async function check() {
            try {
                const screen = await fetchMainScreen();
                if (isActive) setMainScreen(screen);
            } catch {
                // Keeps the last answer; the next check tries again.
            }
        }
        check();
        const stopTicker = startTicker(check, 3000);
        return () => {
            isActive = false;
            stopTicker();
        };
    }, []);

    useEffect(() => {
        let isActive = true;
        // A slow answer isn't overlapped by the next check; that one is just skipped.
        let checking = false;

        async function pollPlayback() {
            if (checking) return;
            checking = true;
            const startedAt = controlCount.current;
            try {
                const response = await adminFetch(`${BACKEND_URI}/playlist/current-play`, { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(statusMessage(response.status));
                }
                const nextPlayback = await response.json();
                // Once the queue has run out the backend still names the last song; show the
                // waiting screen instead of that song paused at its end.
                const finished = await fetchQueueFinished();
                if (isActive && startedAt === controlCount.current) {
                    setPlayback(finished ? { playing: false, song: null } : nextPlayback);
                    setError("");
                }
            } catch (requestError) {
                if (isActive) setError(requestError.message);
            } finally {
                checking = false;
            }
        }

        pollPlayback();
        // Kept up even while this tab is in the background, so a song changed on the Playlist
        // page reaches the YouTube window straight away.
        const stopTicker = startTicker(pollPlayback, 500);
        return () => {
            isActive = false;
            stopTicker();
        };
    }, []);

    const control = useCallback((path) => {
        const sequence = ++controlSequence.current;
        controlCount.current += 1;
        if (path === "play" || path === "pause") {
            // Play/pause shows on screen straight away instead of after the backend answers.
            setPlayback((current) => ({ ...current, playing: path === "play" }));
        }
        const sendControl = async () => {
            try {
                const response = await adminFetch(`${BACKEND_URI}/playlist/${path}`, { method: "POST" });
                const nextPlayback = await response.json().catch(() => null);
                if (sequence !== controlSequence.current) return;
                // Checks sent while the press was on its way can predate it too.
                controlCount.current += 1;
                if (!response.ok) {
                    throw new Error(nextPlayback?.detail || statusMessage(response.status));
                }
                if (path === "play" || path === "pause") {
                    setPlayback((current) => ({ ...current, playing: nextPlayback }));
                } else {
                    setPlayback(nextPlayback);
                }
                setError("");
            } catch (requestError) {
                if (sequence === controlSequence.current) setError(requestError.message);
            }
        };
        const request = controlQueue.current.then(sendControl, sendControl);
        controlQueue.current = request;
        return request;
    }, []);

    // Skip and Back name the song they were pressed on (see fromSong).
    const songPId = playback.song?.p_id;
    const skip = useCallback(() => control(fromSong("skip", songPId)), [control, songPId]);
    const back = () => control(fromSong("back", songPId));
    const playPause = () => control(playback.playing ? "pause" : "play");
    const queue = useQueueSettings();

    async function togglePauseBeforeSongs() {
        try {
            await queue.setPauseBeforeSongs(!queue.pause_before_songs);
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function toggleAutoPlay() {
        try {
            await queue.setAutoPlay(!queue.auto_play);
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function saveAutoPlaySeconds(seconds) {
        try {
            await queue.setAutoPlaySeconds(seconds);
        } catch (requestError) {
            setError(requestError.message);
        }
    }
    const song = playback.song;

    // Only the main screen plays the video: in the YouTube window with the extension, or the
    // built-in player without it (and for a song the YouTube window can't play). Every other device
    // is a remote. While no device is the main screen yet, the first one with the extension
    // becomes it by itself (below), so the event needs no extra step.
    const deviceId = extension?.deviceId || localId;
    const hasExtension = Boolean(extension);
    const isMainScreen = Boolean(deviceId) && mainScreen?.device_id === deviceId;
    const noMainScreen = Boolean(mainScreen) && !mainScreen.device_id;
    let mode = null;
    if (mainScreen !== undefined && (extension !== undefined || touch)) {
        if (hasExtension && (isMainScreen || noMainScreen)) {
            mode = song && fallbackFor === song.p_id ? "stream" : "window";
        } else {
            mode = isMainScreen ? "stream" : "remote";
        }
    }

    async function makeMainScreen({ onlyIfUnset = false } = {}) {
        if (!deviceId) return;
        try {
            setMainScreen(await claimMainScreen(deviceId, { onlyIfUnset }));
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    const claimedAutomatically = useRef(false);
    useEffect(() => {
        if (!noMainScreen || !extension?.deviceId || claimedAutomatically.current) return;
        claimedAutomatically.current = true;
        makeMainScreen({ onlyIfUnset: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [noMainScreen, extension?.deviceId]);

    // Another device took over: close this laptop's YouTube window straight away (the extension
    // also does it by itself within a second or two, even with this page closed).
    const previousMode = useRef(null);
    useEffect(() => {
        if (previousMode.current === "window" && mode === "remote") sendToExtension({ type: "close" });
        previousMode.current = mode;
    }, [mode]);

    // Still checking for the extension (up to 0.8 s on a computer) and the main screen.
    if (mode === null) {
        return (
            <main className={styles.remotePage}>
                <p className={styles.remoteNote}>Loading…</p>
            </main>
        );
    }

    if (mode === "remote") {
        return (
            <main className={styles.remotePage}>
                <RemotePlayer
                    song={song}
                    playing={playback.playing}
                    queue={queue}
                    onError={setError}
                    onPlayPause={playPause}
                    onBack={back}
                    onSkip={skip}
                    mainScreenLabel={mainScreen?.device_id ? mainScreen.label || "another device" : null}
                    onMakeMainScreen={() => makeMainScreen()}
                />
                {error && <p className={styles.remoteError} role="alert">{error}</p>}
            </main>
        );
    }

    // With the extension, this page is the remote and all its controls live in one panel.
    if (mode === "window") {
        return (
            <main className={styles.remotePage}>
                <WindowPlayer
                    song={song}
                    playing={playback.playing}
                    onEnded={skip}
                    extensionAdvances={extensionAdvancesQueue(extension?.version)}
                    onVideoError={setFallbackFor}
                    pauseBeforeSongs={queue.pause_before_songs}
                    settingsLoaded={queue.loaded}
                    onTogglePauseBeforeSongs={togglePauseBeforeSongs}
                    autoPlay={queue.auto_play}
                    onToggleAutoPlay={toggleAutoPlay}
                    autoPlaySeconds={queue.auto_play_seconds}
                    onSaveAutoPlaySeconds={saveAutoPlaySeconds}
                    onPlayPause={playPause}
                    onBack={back}
                    onSkip={skip}
                />
                {error && <p className={styles.remoteError} role="alert">{error}</p>}
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <section className={styles.playerArea} aria-label="Playback view">
                {song && mode === "stream" && (
                    <StreamPlayer song={song} playing={playback.playing} onEnded={skip} onError={setError} />
                )}
                {!song && (
                    <div className={styles.idle}>
                        <span className={`image-placeholder ${styles.idleArt}`}>Stage art</span>
                        <p>Waiting for the next singer...</p>
                        {mode === "stream" && (
                            <p className={styles.hint}>
                                Tip: install the Karole YouTube Controller extension to play every video in a
                                real YouTube window.
                            </p>
                        )}
                    </div>
                )}
                {song && (
                    <p className={styles.songTitle}>
                        {song.youtube_title}
                        <span>{song.name}</span>
                    </p>
                )}
                {error && <p className={styles.error} role="alert">{error}</p>}
            </section>
            <footer className={`${styles.controls} ${playback.playing && song ? styles.playing : ""}`}>
                <button type="button" onClick={back} aria-label="Previous song">Back</button>
                <button className={styles.playButton} type="button" onClick={playPause} aria-label={playback.playing ? "Pause" : "Play"}>
                    {playback.playing ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={skip} aria-label="Next song">Skip</button>
            </footer>
        </main>
    );
}
