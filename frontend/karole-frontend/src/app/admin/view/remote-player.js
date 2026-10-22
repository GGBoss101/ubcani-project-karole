"use client";

import QueueSettingsCard from "../../../components/queue-settings-card";
import styles from "./page.module.css";

// View on a phone or tablet, which can't open the YouTube window: a remote for the screen on the
// laptop. Everything goes through the backend, and the laptop's extension follows within a second
// or two (extension 1.7.2). It shows no video and never moves the queue on by itself.
export default function RemotePlayer({ song, playing, queue, onError, onPlayPause, onBack, onSkip, onPlayHere }) {
    return (
        <div className={styles.remote}>
            <div className={styles.nowShowing}>
                <p className={styles.remoteState}>
                    {song ? (playing ? "Playing" : "Paused") : "Waiting for the next singer"}
                </p>
                {song && (
                    <>
                        <h1 className={styles.remoteTitle}>{song.youtube_title}</h1>
                        <p className={styles.remoteSinger}>{song.name}</p>
                    </>
                )}
            </div>

            <p className={styles.remoteNote}>
                The video plays on the laptop&apos;s screen; volume, speed, captions and full screen are set there.
            </p>

            <div className={styles.transport}>
                <button type="button" onClick={onBack} aria-label="Previous song">Back</button>
                <button className={styles.transportPlay} type="button" onClick={onPlayPause}>
                    {playing ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={onSkip} aria-label="Next song">Skip</button>
            </div>

            <QueueSettingsCard queue={queue} onError={onError} />

            <button type="button" className={`${styles.iconButton} ${styles.modeSwitch}`} onClick={onPlayHere}>
                Play video on this device
            </button>
        </div>
    );
}
