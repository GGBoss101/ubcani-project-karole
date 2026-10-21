// Builds the message shown to the user when a backend request fails, in plain words
// instead of the backend's technical ones.

const FIELD_LABELS = { name: "Your name", song_name: "The song name", url: "The link" };

// Backend messages people can hit while adding songs, reworded.
const FRIENDLY_DETAILS = {
    "Song exists in playlist": "That song is already in tonight's queue.",
    "This name is blacklisted": "This name can't add songs. Please talk to the host.",
    "Song was removed for being too long": "That song was removed for being too long, so it can't be added again.",
    "Queue is closed": "The queue just closed, so no more songs can be added right now.",
    "Video is age-restricted": "That video is age-restricted on YouTube, so it can't be added. Try another upload of the same song.",
};

// One FastAPI validation error (status 422), e.g. a name with characters it doesn't allow.
function describeValidationError(error) {
    const field = FIELD_LABELS[error.loc?.[error.loc.length - 1]] || "Something you entered";
    if (error.type === "string_pattern_mismatch" && field === FIELD_LABELS.name) {
        return `${field} can only use letters, numbers, spaces and _ (no punctuation or emoji).`;
    }
    if (error.type === "string_pattern_mismatch" && field === FIELD_LABELS.song_name) {
        return `${field} can't contain line breaks or invisible characters.`;
    }
    if (error.type === "string_too_long") {
        return `${field} is too long (${error.ctx?.max_length ?? 30} characters at most).`;
    }
    if (error.type === "missing" || error.type === "string_too_short") {
        return `${field} is missing.`;
    }
    if (String(error.msg).includes("Invalid YouTube Video URL")) {
        return "That doesn't look like a YouTube video link.";
    }
    return String(error.msg || "Something you entered isn't valid.").replace(/^Value error, /, "");
}

// For a failed request with no message from the backend. Through /backend, a backend that
// is down (or crashed on this request) shows up as a 5xx reply from this site.
export function statusMessage(status) {
    if (status >= 500) {
        return `The server had a problem (error ${status}). If it keeps happening, check that the backend is running.`;
    }
    if (status === 401 || status === 403) {
        return "You're signed out. Please sign in again.";
    }
    return `Something went wrong (error ${status}). Reload the page and try again.`;
}

export function getErrorMessage(result, response) {
    const detail = result?.detail;
    // FastAPI validation errors (status 422) send "detail" as a list of objects
    // instead of a string, which would otherwise be displayed as "[object Object]".
    if (Array.isArray(detail)) {
        return [...new Set(detail.map(describeValidationError))].join(" ");
    }
    if (typeof detail === "string") {
        return FRIENDLY_DETAILS[detail] || detail;
    }
    return statusMessage(response.status);
}
