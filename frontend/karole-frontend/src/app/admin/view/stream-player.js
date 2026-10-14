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
        return attachSeekableStream(video, source, {
            durationHint: songDuration,
            onFallback: setNotice,
        });
    }, [source, songId, songDuration]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const video = videoRef.current;
            const range = video ? rangeAt(video, video.currentTime) : null;
            const total = video?.duration;
            setDownload(range && Number.isFinite(total) && range.end < total - 1 ? { loaded: range.end, total } : null);
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);

    // songId is a dependency because every song gets a fresh <video> element
    // (see the key below), and that new element has to be started too.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (playing) {
            video.play().catch(() => onError("Playback was blocked. Press play to start the video."));
        } else {
            video.pause();
        }
    }, [playing, songId, onError]);

    return (
        <>
            <video
                key={songId}
                ref={videoRef}
                className={styles.player}
                title={song.url_title}
                playsInline
                preload="auto"
                controls
                onEnded={onEnded}
            />
            {download && <p className={styles.download}>Downloaded up to {formatLength(download.loaded)}</p>}
            {notice && <p className={styles.notice} role="status">{notice}</p>}
        </>
    );
}
