"use client";

// A search box for the Add page: finds YouTube videos through the backend and, when one is
// picked, hands its link to the page to fill in the YouTube URL field. Nothing is played.
import { useEffect, useId, useRef, useState } from "react";
import { BACKEND_URI } from "../lib/config";
import { formatLength } from "../lib/queue-time";
import styles from "./youtube-search.module.css";

// Searches start this long after the last keystroke, so typing a title is one search.
const TYPING_PAUSE_MS = 400;
const MIN_QUERY_LENGTH = 2;

export default function YouTubeSearch({ onPick }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [status, setStatus] = useState("idle");
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(-1);
    const boxRef = useRef(null);
    const listId = useId();

    useEffect(() => {
        const text = query.trim();
        if (text.length < MIN_QUERY_LENGTH) {
            setResults([]);
            setStatus("idle");
            return;
        }
        // A newer search cancels this one, so an older, slower answer never replaces a newer one.
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setStatus("loading");
            try {
                const response = await fetch(`${BACKEND_URI}/playlist/search?q=${encodeURIComponent(text)}`, {
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error();
                const videos = await response.json();
                setResults(videos);
                setHighlighted(-1);
                setStatus(videos.length ? "ready" : "empty");
            } catch {
                if (!controller.signal.aborted) setStatus("error");
            }
        }, TYPING_PAUSE_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    // A tap anywhere else closes the list.
    useEffect(() => {
        function closeOutside(event) {
            if (!boxRef.current?.contains(event.target)) setOpen(false);
        }
        document.addEventListener("pointerdown", closeOutside);
        return () => document.removeEventListener("pointerdown", closeOutside);
    }, []);

    function pick(video) {
        onPick(video);
        setOpen(false);
    }

    function handleKeyDown(event) {
        if (event.key === "Escape") {
            setOpen(false);
            return;
        }
        if (!results.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const step = event.key === "ArrowDown" ? 1 : -1;
            setHighlighted((index) => (index + step + results.length) % results.length);
        } else if (event.key === "Enter" && open) {
            // Enter in this box never submits the form: it picks the highlighted video.
            event.preventDefault();
            if (highlighted >= 0) pick(results[highlighted]);
        }
    }

    const showPanel = open && status !== "idle";

    return (
        <div className={styles.search} ref={boxRef}>
            <label className={styles.label} htmlFor={`${listId}-input`}>
                Search YouTube
            </label>
            <div className={styles.inputWrap}>
                <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                    id={`${listId}-input`}
                    type="search"
                    role="combobox"
                    aria-expanded={showPanel}
                    aria-controls={listId}
                    aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
                    autoComplete="off"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    // Phones keep the box focused after a tap elsewhere closes the list, so a
                    // second tap on it fires no focus event: the tap itself reopens the list.
                    onClick={() => setOpen(true)}
                    onKeyDown={handleKeyDown}
                    placeholder="Song title, artist, or anime..."
                    maxLength={100}
                />
            </div>

            {showPanel && (
                <div className={styles.panel}>
                    {status === "loading" && <p className={styles.note}>Searching...</p>}
                    {status === "empty" && <p className={styles.note}>No videos found. Try other words.</p>}
                    {status === "error" && (
                        <p className={styles.note}>Search isn&apos;t working right now. You can still paste a link below.</p>
                    )}
                    {status === "ready" && (
                        <ul className={styles.results} id={listId} role="listbox" aria-label="YouTube results">
                            {results.map((video, index) => (
                                <li
                                    key={video.url_id}
                                    id={`${listId}-${index}`}
                                    role="option"
                                    aria-selected={index === highlighted}
                                    className={index === highlighted ? styles.highlighted : ""}
                                    onPointerEnter={() => setHighlighted(index)}
                                    onClick={() => pick(video)}
                                >
                                    <span className={styles.thumb}>
                                        {/* A plain img: YouTube already serves the thumbnail small. */}
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={video.thumbnail} alt="" loading="lazy" />
                                        {video.duration ? (
                                            <span className={styles.duration}>{formatLength(video.duration)}</span>
                                        ) : null}
                                    </span>
                                    <span className={styles.info}>
                                        <span className={styles.title}>{video.title}</span>
                                        <span className={styles.channel}>{video.channel}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
