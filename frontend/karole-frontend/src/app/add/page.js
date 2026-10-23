"use client";

import { useState, useSyncExternalStore } from "react";
import { BACKEND_URI } from "../../lib/config";
import { getErrorMessage } from "../../lib/api-error";
import { normalizeYouTubeUrl } from "../../lib/youtube";
import Image from "next/image";
import Link from "next/link";
import banner from "../../../assets/banner1_final.png";
import Header from "../../components/header";
import QueueItem from "../../components/queue-item";
import YouTubeSearch from "../../components/youtube-search";
import { usePlaylist } from "../../lib/use-playlist";
import { useQueueSettings } from "../../lib/use-queue-settings";
import { describeEstimate } from "../../lib/queue-time";
import styles from "./page.module.css";

const NAME_COOKIE = "karole-user-name";
const NAME_COOKIE_SECONDS = 60 * 60 * 24 * 365;

function subscribeToSavedName() {
    // Cookies have no change event. The page reads the cookie again whenever it renders,
    // which it does right after saving a name.
    return () => {};
}

function getSavedName() {
    // document.cookie looks like "first=value; second=value".
    for (const cookie of document.cookie.split("; ")) {
        const [cookieName, cookieValue] = cookie.split("=");
        if (cookieName === NAME_COOKIE) {
            return decodeURIComponent(cookieValue);
        }
    }
    return "";
}

function saveName(name) {
    document.cookie = `${NAME_COOKIE}=${encodeURIComponent(name)}; max-age=${NAME_COOKIE_SECONDS}; path=/; samesite=lax`;
}

// A failed request with no reply from the backend itself means either the backend is down,
// or it crashed while looking the video up. Asking the backend for /ping tells the two apart.
async function explainFailedRequest() {
    try {
        const response = await fetch(`${BACKEND_URI}/ping`, { cache: "no-store" });
        if (response.ok) {
            return "The server couldn't look up that video. Check that the link opens and the video is public. If it does, YouTube may be blocking lookups for a while, so try again in a few minutes.";
        }
    } catch {
        // Falls through to the message below.
    }
    return "Can't reach the server right now. Please let the host know.";
}

function getServerName() {
    return "";
}

export default function AddSong() {
    const [form, setForm] = useState({ url: "", name: "", song_name: "" });
    const [submittedName, setSubmittedName] = useState("");
    const [status, setStatus] = useState("idle");
    const [message, setMessage] = useState("");
    const savedName = useSyncExternalStore(subscribeToSavedName, getSavedName, getServerName);
    const name = savedName || submittedName || form.name;
    const hasSavedName = Boolean(savedName || submittedName);
    const { songs, upcoming, currentId, progress, now, status: queueStatus } = usePlaylist();
    // A first-time singer whose name is already in tonight's queue: asked whether it's them.
    const [nameTaken, setNameTaken] = useState("");
    const upNext = upcoming.slice(0, 4);
    const queue = useQueueSettings();
    const isClosed = queue.loaded && !queue.open;

    function updateField(event) {
        const { name, value } = event.target;
        setForm((currentForm) => ({ ...currentForm, [name]: value }));
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!name.trim()) {
            setStatus("error");
            setMessage("Please enter your name before adding a song.");
            return;
        }

        const link = normalizeYouTubeUrl(form.url);
        if (link.error) {
            setStatus("error");
            setMessage(link.error);
            return;
        }

        // The backend treats the same name as the same person, so a second person called "Dana"
        // would share the first Dana's place in line. Someone adding their first song from this
        // phone is asked first if the name is already in the queue.
        const wanted = name.trim().toLowerCase();
        const sameName = songs.find((song) => song.name.trim().toLowerCase() === wanted);
        if (!hasSavedName && sameName && nameTaken !== name.trim()) {
            setNameTaken(name.trim());
            setStatus("idle");
            setMessage("");
            return;
        }
        setNameTaken("");
        // "That's me": use the name exactly as it's already written ("Dana", not "dana"),
        // because the backend counts differently spelled names as different people.
        const submitName = !hasSavedName && sameName ? sameName.name : name.trim();

        setStatus("loading");
        setMessage("");

        try {
            const response = await fetch(`${BACKEND_URI}/playlist/add`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...form, url: link.url, name: submitName }),
            });
            const result = await response.json().catch(() => null);

            if (!response.ok) {
                // A 5xx without the backend's JSON comes from this site's /backend pass-through.
                const fromBackend = result || response.status < 500;
                throw new Error(fromBackend ? getErrorMessage(result, response) : await explainFailedRequest());
            }

            saveName(submitName);
            setForm({ ...form, name: submitName });
            setSubmittedName(submitName);
            setStatus("success");
            setMessage(`Added "${result.youtube_title || "song"}" to the playlist.`);
        } catch (requestError) {
            setStatus("error");
            setMessage(requestError instanceof TypeError ? await explainFailedRequest() : requestError.message);
        }
    }

    return (
        <main className={styles.page}>
            <Header />
            {/* next/image serves this huge source file resized for each screen. */}
            <Image
                className={styles.hero}
                src={banner}
                alt="UBCAni anime club banner"
                priority
                placeholder="blur"
                sizes="(max-width: 1168px) calc(100vw - 32px), 1120px"
            />
            <div className={styles.layout}>
                <section className={styles.card}>
                    <div className={styles.heading}>
                        <p className={styles.eyebrow}>Join the queue</p>
                        <h1>Add a song</h1>
                        <p className={styles.intro}>Search for your song or paste a YouTube link, and you&apos;re in line to sing.</p>
                    </div>

                    {isClosed && (
                        <div className={styles.closed} role="status">
                            <strong>The queue is closed for now.</strong>
                            <p>The host has stopped taking songs. Check back in a bit, or enjoy the show!</p>
                        </div>
                    )}

                    <form className={styles.form} onSubmit={handleSubmit} hidden={isClosed}>
                        <YouTubeSearch
                            onPick={(video) => {
                                setForm((currentForm) => ({ ...currentForm, url: video.url }));
                                setStatus("idle");
                                setMessage("");
                            }}
                        />

                        <label className={styles.field}>
                            <span>YouTube URL</span>
                            <input
                                name="url"
                                type="text"
                                inputMode="url"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                value={form.url}
                                onChange={updateField}
                                placeholder="https://youtube.com/watch?v=..."
                                required
                            />
                        </label>

                        <div className={styles.row}>
                            <label className={styles.field}>
                                <span>Your name</span>
                                <input
                                    name="name"
                                    type="text"
                                    value={name}
                                    onChange={(event) => {
                                        setNameTaken("");
                                        updateField(event);
                                    }}
                                    placeholder="Your name"
                                    maxLength={30}
                                    readOnly={hasSavedName}
                                    required
                                />
                            </label>

                            <label className={styles.field}>
                                <span>Song name</span>
                                <input
                                    name="song_name"
                                    type="text"
                                    value={form.song_name}
                                    onChange={updateField}
                                    placeholder="Song name"
                                    maxLength={70}
                                    required
                                />
                            </label>
                        </div>

                        {nameTaken && (
                            <div className={styles.nameTaken} role="alert">
                                <strong>Someone called &quot;{nameTaken}&quot; is already in the queue.</strong>
                                <p>
                                    If that&apos;s you, go ahead. If not, please use a different name, for example
                                    with your last initial (&quot;{nameTaken} K&quot;), so your songs aren&apos;t mixed up.
                                </p>
                                <div className={styles.nameTakenActions}>
                                    <button className="button-primary" type="submit">That&apos;s me, add my song</button>
                                    <button
                                        className={styles.secondaryButton}
                                        type="button"
                                        onClick={() => {
                                            setNameTaken("");
                                            setForm((currentForm) => ({ ...currentForm, name: "" }));
                                            document.querySelector("input[name=name]")?.focus();
                                        }}
                                    >
                                        Use a different name
                                    </button>
                                </div>
                            </div>
                        )}

                        <button
                            className={`button-primary ${styles.submit}`}
                            type="submit"
                            disabled={status === "loading"}
                            hidden={Boolean(nameTaken)}
                        >
                            {status === "loading" ? "Adding song..." : "Add to playlist"}
                        </button>

                        {message && (
                            <p className={status === "error" ? styles.error : styles.success} role="status">
                                {message}
                            </p>
                        )}
                    </form>
                </section>

                <aside className={styles.upNext} aria-label="Up next">
                    <div className={styles.upNextHeading}>
                        <h2>
                            <span className={styles.liveDot} aria-hidden="true" />
                            Up next
                        </h2>
                        <Link href="/playlist">Full queue</Link>
                    </div>
                    {upcoming.length > 0 && (
                        <p className={styles.queueMessage}>
                            {upcoming.length} {upcoming.length === 1 ? "song" : "songs"} · {describeEstimate(upcoming, progress, now, " to go")}
                        </p>
                    )}
                    {queueStatus === "loading" && <p className={styles.queueMessage}>Loading queue...</p>}
                    {queueStatus === "error" && <p className={styles.queueMessage}>The queue is unavailable right now.</p>}
                    {queueStatus === "ready" && upNext.length === 0 && (
                        <p className={styles.queueMessage}>The queue is empty. Yours could be first!</p>
                    )}
                    {upNext.length > 0 && (
                        <ol className={styles.queue}>
                            {upNext.map((song, index) => (
                                <QueueItem
                                    key={song.p_id}
                                    song={song}
                                    position={index + 1}
                                    nowPlaying={song.p_id === currentId}
                                    compact
                                    wideNumber={upNext.length >= 100}
                                />
                            ))}
                        </ol>
                    )}
                    {upcoming.length > upNext.length && (
                        <p className={styles.queueMessage}>+{upcoming.length - upNext.length} more in the queue</p>
                    )}
                </aside>
            </div>
        </main>
    );
}
