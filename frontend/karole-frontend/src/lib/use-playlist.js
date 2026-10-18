// The public playlist, in queue order, refreshed every few seconds so the page stays live.
// The playlist keeps songs that were already sung, so this also finds the one playing now.
import { useEffect, useState } from "react";
import { BACKEND_URI } from "./config";
import { statusMessage } from "./api-error";

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
    const [status, setStatus] = useState("loading");
    const [error, setError] = useState("");

    useEffect(() => {
        let isActive = true;

        async function loadPlaylist() {
            try {
                const [response, nowPlayingResponse, queueFinished] = await Promise.all([
                    fetch(`${BACKEND_URI}/playlist/`, { cache: "no-store" }),
                    fetch(`${BACKEND_URI}/playlist/now-playing`, { cache: "no-store" }),
                    fetchQueueFinished(),
                ]);
                if (!response.ok) {
                    throw new Error(statusMessage(response.status));
                }
                const playlist = await response.json();
                const nowPlaying = nowPlayingResponse.ok ? await nowPlayingResponse.json().catch(() => null) : null;
                if (isActive) {
                    setSongs(playlist.slice().sort((first, second) => first.order_num - second.order_num));
                    setCurrentId(nowPlaying?.p_id ?? null);
                    setFinished(queueFinished);
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

        return () => {
            isActive = false;
            window.clearInterval(refreshTimer);
        };
    }, []);

    // Songs from the one playing now onwards (or after the last one sung, once the queue
    // has run out); everything when nothing has started yet.
    const currentIndex = songs.findIndex((song) => song.p_id === currentId);
    const upcoming = currentIndex >= 0 ? songs.slice(currentIndex + (finished ? 1 : 0)) : songs;
    // The song being sung right now, if any.
    const nowPlayingId = finished ? null : currentId;

    return { songs, upcoming, currentId: nowPlayingId, status, error };
}
