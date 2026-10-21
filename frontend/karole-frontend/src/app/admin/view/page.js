"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_URI } from "../../../lib/config";
import { adminFetch } from "../../../lib/admin-auth";
import { statusMessage } from "../../../lib/api-error";
import { fetchQueueFinished } from "../../../lib/use-playlist";
import { detectExtension, extensionAdvancesQueue } from "../../../lib/youtube-window";
import { startTicker } from "../../../lib/background-ticker";
import { useQueueSettings } from "../../../lib/use-queue-settings";
import StreamPlayer from "./stream-player";
import WindowPlayer from "./window-player";
import styles from "./page.module.css";

export default function AdminView() {
    const [playback, setPlayback] = useState({ playing: false, song: null });
    const [error, setError] = useState("");
    // "window" when the Karole YouTube Controller extension is installed (songs play in a
    // real YouTube window), "stream" for the built-in player, null while checking.
    const [mode, setMode] = useState(null);
    const [extensionVersion, setExtensionVersion] = useState(null);
    // Goes up with every button press. A status check that was already on its way when a button
    // was pressed may carry the state from before it (over a slow link it can arrive after the
    // press is done), so its answer is ignored rather than undoing the press.
    const controlCount = useRef(0);
    const controlSequence = useRef(0);
    const controlQueue = useRef(Promise.resolve());

    useEffect(() => {
        detectExtension().then((version) => {
            setExtensionVersion(version);
            setMode(version ? "window" : "stream");
        });
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
        if (path === "play_pause") {
            // Play/pause shows on screen straight away instead of after the backend answers.
            setPlayback((current) => ({ ...current, playing: !current.playing }));
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
                if (path === "play_pause") {
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

    const skip = useCallback(() => control("skip"), [control]);
    const queue = useQueueSettings();

    async function togglePauseBeforeSongs() {
        try {
            await queue.setPauseBeforeSongs(!queue.pause_before_songs);
        } catch (requestError) {
            setError(requestError.message);
        }
    }
    const song = playback.song;

    // With the extension, this page is the remote and all its controls live in one panel.
    if (mode === "window") {
        return (
            <main className={styles.remotePage}>
                <WindowPlayer
                    song={song}
                    playing={playback.playing}
                    onEnded={skip}
                    extensionAdvances={extensionAdvancesQueue(extensionVersion)}
                    pauseBeforeSongs={queue.pause_before_songs}
                    settingsLoaded={queue.loaded}
                    onTogglePauseBeforeSongs={togglePauseBeforeSongs}
                    onPlayPause={() => control("play_pause")}
                    onBack={() => control("back")}
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
                <button type="button" onClick={() => control("back")} aria-label="Previous song">Back</button>
                <button className={styles.playButton} type="button" onClick={() => control("play_pause")} aria-label={playback.playing ? "Pause" : "Play"}>
                    {playback.playing ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={skip} aria-label="Next song">Skip</button>
            </footer>
        </main>
    );
}
