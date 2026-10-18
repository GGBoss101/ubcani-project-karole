"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_URI } from "../../../lib/config";
import { adminFetch } from "../../../lib/admin-auth";
import { statusMessage } from "../../../lib/api-error";
import { fetchQueueFinished } from "../../../lib/use-playlist";
import { detectExtension } from "../../../lib/youtube-window";
import StreamPlayer from "./stream-player";
import WindowPlayer from "./window-player";
import styles from "./page.module.css";

export default function AdminView() {
    const [playback, setPlayback] = useState({ playing: false, song: null });
    const [error, setError] = useState("");
    // "window" when the Karole YouTube Controller extension is installed (songs play in a
    // real YouTube window), "stream" for the built-in player, null while checking.
    const [mode, setMode] = useState(null);
    // Goes up with every button press. A status check that was already on its way when a button
    // was pressed may carry the state from before it (over a slow link it can arrive after the
    // press is done), so its answer is ignored rather than undoing the press.
    const controlCount = useRef(0);

    useEffect(() => {
        detectExtension().then((version) => setMode(version ? "window" : "stream"));
    }, []);

    useEffect(() => {
        let isActive = true;

        async function pollPlayback() {
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
            }
        }

        pollPlayback();
        const timer = window.setInterval(pollPlayback, 500);
        return () => {
            isActive = false;
            window.clearInterval(timer);
        };
    }, []);

    const control = useCallback(async (path) => {
        controlCount.current += 1;
        if (path === "play_pause") {
            // Play/pause shows on screen straight away instead of after the backend answers.
            setPlayback((current) => ({ ...current, playing: !current.playing }));
        }
        try {
            const response = await adminFetch(`${BACKEND_URI}/playlist/${path}`, { method: "POST" });
            const nextPlayback = await response.json().catch(() => null);
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
            setError(requestError.message);
        }
    }, []);

    const skip = useCallback(() => control("skip"), [control]);
    const song = playback.song;

    // With the extension, this page is the remote and all its controls live in one panel.
    if (mode === "window") {
        return (
            <main className={styles.remotePage}>
                <WindowPlayer
                    song={song}
                    playing={playback.playing}
                    onEnded={skip}
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
