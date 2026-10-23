// The "main screen": the one device that plays the video (in the YouTube window with the
// extension, or the built-in player without it). Every other device's View is a remote. The
// backend remembers which device it is; each browser has its own made-up ID.
import { BACKEND_URI } from "./config";
import { adminFetch } from "./admin-auth";
import { getErrorMessage, statusMessage } from "./api-error";

const DEVICE_ID_KEY = "karole-device-id";
let unsavedDeviceId = null;

function newDeviceId() {
    // randomUUID needs https or localhost; over plain http a random string does just as well.
    return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

// This browser's ID, kept in localStorage. When storage is blocked (some private windows) it lasts
// only while the page is open. A browser with the extension uses the extension's ID instead (see
// detectExtensionInfo), which is the same at every address the site is opened at.
export function localDeviceId() {
    try {
        let id = window.localStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
            id = newDeviceId();
            window.localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    } catch {
        unsavedDeviceId ??= newDeviceId();
        return unsavedDeviceId;
    }
}

// A short name for this device that admins can recognise, e.g. "Chrome on Mac".
export function deviceLabel() {
    const agent = navigator.userAgent;
    const browser = /Edg\//.test(agent) ? "Edge"
        : /Firefox\//.test(agent) ? "Firefox"
        : /Chrome\//.test(agent) ? "Chrome"
        : /Safari\//.test(agent) ? "Safari"
        : "Browser";
    const system = /iPhone/.test(agent) ? "iPhone"
        : /iPad/.test(agent) ? "iPad"
        : /Android/.test(agent) ? "Android"
        : /Mac OS X/.test(agent) ? "Mac"
        : /Windows/.test(agent) ? "Windows"
        : /Linux/.test(agent) ? "Linux"
        : "a device";
    return `${browser} on ${system}`;
}

// { device_id, label, since }; device_id is null while no device has been made the main screen.
export async function fetchMainScreen() {
    const response = await adminFetch(`${BACKEND_URI}/playlist/screen`, { cache: "no-store" });
    if (!response.ok) throw new Error(statusMessage(response.status));
    return response.json();
}

// Makes this device the main screen. With onlyIfUnset, only when no device is yet (nothing is
// taken from another device). Answers with the main screen afterwards.
export async function claimMainScreen(deviceId, { onlyIfUnset = false } = {}) {
    const response = await adminFetch(`${BACKEND_URI}/playlist/screen?only_if_unset=${onlyIfUnset}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, label: deviceLabel() }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getErrorMessage(result, response));
    return result;
}
