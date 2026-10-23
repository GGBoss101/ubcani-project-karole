"use client";

import AutoPlayDelay from "./auto-play-delay";
import styles from "./queue-settings-card.module.css";

// The queue's switches in one card, the same on a laptop and a phone: one row per setting, its name
// and what it does on the left, its switch on the right. "Auto-play after a delay" sits indented
// under "Start each song paused", which it needs, with its seconds box at the end of its row.
// `queue` is useQueueSettings(); a failed save is passed to onError.
export default function QueueSettingsCard({ queue, onError, showOpen = true, className = "" }) {
    function run(change) {
        return async (...args) => {
            onError("");
            try {
                await change(...args);
            } catch (requestError) {
                onError(requestError.message);
            }
        };
    }

    const autoPlayOn = queue.pause_before_songs && queue.auto_play;

    return (
        <section className={`${styles.card} ${className}`} aria-label="Queue settings">
            <h2 className={styles.title}>Queue settings</h2>

            {showOpen && (
                <SettingRow
                    id="queue-open"
                    name={queue.open ? "Taking songs" : "Queue closed"}
                    hint={queue.open ? "People can add songs from the Add page" : "The Add page isn't taking new songs"}
                    on={queue.open}
                    danger
                    disabled={!queue.loaded}
                    onToggle={run(() => queue.setOpen(!queue.open))}
                />
            )}
            <SettingRow
                id="queue-pause"
                name="Start each song paused"
                hint="New songs wait at the start until you press Play"
                on={queue.pause_before_songs}
                disabled={!queue.loaded}
                onToggle={run(() => queue.setPauseBeforeSongs(!queue.pause_before_songs))}
            />
            <SettingRow
                id="queue-auto-play"
                name="Auto-play after a delay"
                hint="Songs start paused, then play automatically after the set delay. Pressing Play or Pause stops the countdown."
                on={autoPlayOn}
                nested
                disabled={!queue.pause_before_songs || !queue.loaded}
                onToggle={run(() => queue.setAutoPlay(!queue.auto_play))}
            >
                <AutoPlayDelay
                    seconds={queue.auto_play_seconds}
                    disabled={!autoPlayOn || !queue.loaded}
                    onSave={run(queue.setAutoPlaySeconds)}
                />
            </SettingRow>
        </section>
    );
}

function SettingRow({ id, name, hint, on, danger = false, nested = false, disabled, onToggle, children }) {
    const rowClasses = [
        styles.row,
        nested ? styles.nested : "",
        children ? styles.withExtra : "",
        disabled ? styles.unavailable : "",
    ].join(" ");
    return (
        <div className={rowClasses}>
            <div className={styles.text}>
                <span className={`${styles.name} ${danger && !on ? styles.dangerText : ""}`} id={`${id}-name`}>{name}</span>
                <span className={styles.hint} id={`${id}-hint`}>{hint}</span>
            </div>
            {children && <div className={styles.extra}>{children}</div>}
            <button
                className={`${styles.switch} ${on ? styles.on : ""} ${danger && !on ? styles.danger : ""}`}
                type="button"
                role="switch"
                aria-checked={Boolean(on)}
                aria-labelledby={`${id}-name`}
                aria-describedby={`${id}-hint`}
                onClick={onToggle}
                disabled={disabled}
            >
                <span className={styles.track} aria-hidden="true">
                    <span className={styles.thumb} />
                </span>
            </button>
        </div>
    );
}
