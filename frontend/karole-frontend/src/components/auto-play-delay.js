"use client";

import { useState } from "react";
import styles from "./auto-play-delay.module.css";

const MIN_SECONDS = 1;
const MAX_SECONDS = 300;

// The seconds box beside the "Auto-play after a delay" switch: how long a held song waits, once
// it's ready, before playing by itself (extension 1.7.1). Saved when the box loses focus or Enter
// is pressed; anything that isn't a number puts the saved value back.
export default function AutoPlayDelay({ seconds, disabled, onSave, className = "" }) {
    // What's being typed, until it's saved; otherwise the saved value shows.
    const [draft, setDraft] = useState(null);

    async function save() {
        if (draft === null) return;
        const typed = Number(draft.trim() || NaN);
        const next = Number.isFinite(typed) ? Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(typed))) : seconds;
        try {
            if (next !== seconds) await onSave(next);
        } finally {
            setDraft(null);
        }
    }

    return (
        <label className={`${styles.delay} ${disabled ? styles.off : ""} ${className}`}>
            <input
                className={styles.input}
                type="number"
                inputMode="numeric"
                min={MIN_SECONDS}
                max={MAX_SECONDS}
                step="1"
                value={draft ?? String(seconds)}
                disabled={disabled}
                aria-label="Seconds before the song plays by itself"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={save}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
            />
            seconds
        </label>
    );
}
