// Whether merging one name into another also combines their queues (both names' songs
// count as one person's turns and the waiting ones line up again) or only relabels the
// songs, which keep their places. Shown on both the Names and Operations pages, which
// share this one setting. Kept in this browser only, and on unless switched off.
const STORAGE_KEY = "karole-combine-queues";

export function loadCombineQueues() {
    try {
        return window.localStorage.getItem(STORAGE_KEY) !== "false";
    } catch {
        return true;
    }
}

export function saveCombineQueues(combine) {
    try {
        window.localStorage.setItem(STORAGE_KEY, String(combine));
    } catch {
        // Private browsing can block storage; the switch then lasts until the page reloads.
    }
}
