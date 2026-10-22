// The public playlist, in queue order, refreshed every few seconds so the page stays live, with
// how far into the current song playback is and the start delay settings (`progress`, from
// /playlist/progress), for the live "about 40–45 min to go".
// The playlist keeps songs that were already sung, so this also finds the one playing now.
import { useEffect, useState } from "react";
import { BACKEND_URI } from "./config";
import { statusMessage } from "./api-error";
import { stampClock } from "./queue-time";

const REFRESH_MS = 5000;

// Whether playback has run past the last song. now-playing then still names that song,
// which marks where the sung part of the queue ends. Older backends say nothing (false).
export async function fetchQueueFinished() {
    try {
        const response = await fetch(`${BACKEND_URI}/playlist/queue-finished`, { cache: "no-store" });
        return response.ok ? (await response.json()) === true : false;
    } catch {
        return false;
    }
}

export function usePlaylist() {
    const [songs, setSongs] = useState([]);
    const [currentId, setCurrentId] = useState(null);
    const [finished, setFinished] = useState(false);
    const [progress, setProgress] = useState(null);
    // This device's clock in seconds, moved on every 30 seconds (and on each refresh): the
    // estimate shows whole minutes, so that's often enough.
    const [now, setNow] = useState(0);
    const [status, setStatus] = useState("loading");
    const [error, setError] = useState("");

    useEffect(() => {
        let isActive = true;

        async function loadPlaylist() {
            try {
                const [response, progressResponse] = await Promise.all([
                    fetch(`${BACKEND_URI}/playlist/`, { cache: "no-store" }),
                    fetch(`${BACKEND_URI}/playlist/progress`, { cache: "no-store" }),
                ]);
                if (!response.ok) {
                    throw new Error(statusMessage(response.status));
                }
                const playlist = await response.json();
                const nextProgress = progressResponse.ok ? await progressResponse.json().catch(() => null) : null;
                if (isActive) {
                    setSongs(playlist.slice().sort((first, second) => first.order_num - second.order_num));
                    setCurrentId(nextProgress?.p_id ?? null);
                    setFinished(nextProgress?.finished === true);
                    setProgress(stampClock(nextProgress));
                    setNow(Date.now() / 1000);
                    setStatus("ready");
                    setError("");
                }
            } catch (requestError) {
                if (isActive) {
                    setError(requestError.message);
                    setStatus("error");
                }
            }
        }

        loadPlaylist();
        const refreshTimer = window.setInterval(loadPlaylist, REFRESH_MS);
        const clockTimer = window.setInterval(() => setNow(Date.now() / 1000), 30000);

        return () => {
            isActive = false;
            window.clearInterval(refreshTimer);
            window.clearInterval(clockTimer);
        };
    }, []);

    // Songs from the one playing now onwards (or after the last one sung, once the queue
    // has run out); everything when nothing has started yet.
    const currentIndex = songs.findIndex((song) => song.p_id === currentId);
    const upcoming = currentIndex >= 0 ? songs.slice(currentIndex + (finished ? 1 : 0)) : songs;
    // The song being sung right now, if any.
    const nowPlayingId = finished ? null : currentId;

    return { songs, upcoming, currentId: nowPlayingId, progress, now, status, error };
}
