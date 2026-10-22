"use client";

import { useState } from "react";
import QueueSettingsCard from "../../../components/queue-settings-card";
import styles from "./page.module.css";

// View on any device that isn't the main screen: a remote for the screen. Everything goes through
// the backend, and the main screen follows within a second or two. It shows no video and never
// moves the queue on by itself. "Make this the main screen" moves the video here (after a
// confirm on the page), and the old main screen stops.
export default function RemotePlayer({
    song,
    playing,
    queue,
    onError,
    onPlayPause,
    onBack,
    onSkip,
    mainScreenLabel,
    onMakeMainScreen,
}) {
    const [confirming, setConfirming] = useState(false);
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
                {mainScreenLabel
                    ? `The video plays on the main screen (${mainScreenLabel}); volume, speed, captions and full screen are set there.`
                    : "No device is the main screen yet, so the video isn't playing anywhere."}
            </p>

            <div className={styles.transport}>
                <button type="button" onClick={onBack} aria-label="Previous song">Back</button>
                <button className={styles.transportPlay} type="button" onClick={onPlayPause}>
                    {playing ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={onSkip} aria-label="Next song">Skip</button>
            </div>

            <QueueSettingsCard queue={queue} onError={onError} />

            {confirming ? (
                <div className={styles.confirm} role="group" aria-label="Make this the main screen">
                    <p>
                        The video will play on this device
                        {mainScreenLabel ? ` and stop on ${mainScreenLabel}` : ""}. Every other device becomes a remote.
                    </p>
                    <div className={styles.confirmButtons}>
                        <button
                            type="button"
                            className={`${styles.iconButton} ${styles.toggleOn}`}
                            onClick={() => {
                                setConfirming(false);
                                onMakeMainScreen();
                            }}
                        >
                            Make this the main screen
                        </button>
                        <button type="button" className={styles.iconButton} onClick={() => setConfirming(false)}>
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    className={`${styles.iconButton} ${styles.modeSwitch}`}
                    onClick={() => setConfirming(true)}
                >
                    Make this the main screen
                </button>
            )}
        </div>
    );
}
