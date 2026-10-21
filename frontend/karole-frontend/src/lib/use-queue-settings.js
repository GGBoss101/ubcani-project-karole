// The queue's shared settings, kept by the backend: whether it is accepting new songs (open),
// and whether each new song waits at the start for Play (pause_before_songs).
import { useCallback, useEffect, useState } from "react";
import { BACKEND_URI } from "./config";
import { adminFetch } from "./admin-auth";
import { getErrorMessage, statusMessage } from "./api-error";

const REFRESH_MS = 5000;

export async function fetchQueueSettings() {
    const response = await fetch(`${BACKEND_URI}/playlist/queue-settings`, { cache: "no-store" });
    if (!response.ok) throw new Error(statusMessage(response.status));
    return response.json();
}

export function useQueueSettings() {
    const [settings, setSettings] = useState({ open: true, pause_before_songs: false, loaded: false });

    const refresh = useCallback(async () => {
        try {
            setSettings({ ...(await fetchQueueSettings()), loaded: true });
        } catch {
            // Keep the last known state; the next refresh tries again.
        }
    }, []);

    useEffect(() => {
        Promise.resolve().then(refresh);
        const timer = window.setInterval(refresh, REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [refresh]);

    // Changes only the settings given, e.g. { open: false }.
    async function update(changes) {
        const response = await adminFetch(`${BACKEND_URI}/playlist/queue-settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(changes),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getErrorMessage(result, response));
        setSettings({ ...result, loaded: true });
    }

    return {
        ...settings,
        setOpen: (open) => update({ open }),
        setPauseBeforeSongs: (pause) => update({ pause_before_songs: pause }),
    };
}
