// Whether merging one name into another also combines their queues (the merged name's
// waiting songs line up again as the other person's next songs) or only relabels the
// songs, which keep their places. Set on the Names page; matching on the Operations page
// follows it too. Kept in this browser only, and on unless switched off.
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
