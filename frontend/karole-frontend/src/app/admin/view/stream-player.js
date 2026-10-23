"use client";

import { useEffect, useRef, useState } from "react";
import { BACKEND_URI } from "../../../lib/config";
import { attachSeekableStream, rangeAt } from "../../../lib/seekable-stream";
import { formatLength } from "../../../lib/queue-time";
import styles from "./page.module.css";

// The built-in player: plays the backend's video stream in this page. Used when the
// Karole YouTube Controller extension isn't installed.
export default function StreamPlayer({ song, playing, onEnded, onError }) {
    const videoRef = useRef(null);
    const [notice, setNotice] = useState("");
    // Set when the song can't be loaded at all; "Try again" bumps attempt to load it afresh.
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    // How far the song has downloaded from where it is playing; jumps within that are instant.
    const [download, setDownload] = useState(null);
    const songId = song.p_id;
    const songDuration = song.duration;
    // The browser sends the login cookie with the video request by itself.
    const source = `${BACKEND_URI}/playlist/playback-stream`;

    // Downloads the whole song so any point in it can be jumped to (see seekable-stream.js).
    // The duration lets the seek bar show the full length before the download finishes.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        setNotice("");
        setFailed(false);
        return attachSeekableStream(video, source, {
            durationHint: songDuration,
            onFallback: setNotice,
            onFailure: () => setFailed(true),
        });
    }, [source, songId, songDuration, attempt]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const video = videoRef.current;
            const range = video ? rangeAt(video, video.currentTime) : null;
            const total = video?.duration;
            setDownload(range && Number.isFinite(total) && range.end < total - 1 ? { loaded: range.end, total } : null);
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);

    // songId and attempt are dependencies because each gets a fresh <video> element
    // (see the key below), and that new element has to be started too.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (playing) {
            video.play().catch(() => onError("Playback was blocked. Press play to start the video."));
        } else {
            video.pause();
        }
    }, [playing, songId, attempt, onError]);

    return (
        <>
            <video
                key={`${songId}-${attempt}`}
                ref={videoRef}
                className={styles.player}
                title={song.youtube_title}
                playsInline
                preload="auto"
                controls
                onEnded={onEnded}
                onError={() => setFailed(true)}
            />
            {download && <p className={styles.download}>Downloaded up to {formatLength(download.loaded)}</p>}
            {failed ? (
                <div className={`${styles.notice} ${styles.failed}`} role="alert">
                    <p>
                        This video couldn&apos;t be loaded. YouTube may be blocking the server for a while,
                        or the video may be private or removed. Skip to the next song, or try again.
                    </p>
                    <button type="button" className={styles.retry} onClick={() => setAttempt(attempt + 1)}>
                        Try again
                    </button>
                </div>
            ) : (
                notice && <p className={styles.notice} role="status">{notice}</p>
            )}
        </>
    );
}
