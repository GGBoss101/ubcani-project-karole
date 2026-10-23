// A repeating timer that keeps its pace while the tab is in the background. Browsers slow a
// hidden page's own timers down, to once a minute after a few minutes, but not a worker's, so
// the ticks come from a tiny worker made on the spot. If a worker can't be made, an ordinary
// timer is used instead. Returns a function that stops it.
export function startTicker(onTick, intervalMs) {
    let worker = null;
    let workerUrl = null;
    let fallbackTimer = 0;

    function switchToPlainTimer() {
        if (fallbackTimer) return;
        stopWorker();
        fallbackTimer = window.setInterval(onTick, intervalMs);
    }

    function stopWorker() {
        worker?.terminate();
        worker = null;
        if (workerUrl) URL.revokeObjectURL(workerUrl);
        workerUrl = null;
    }

    try {
        const source = `setInterval(() => postMessage(0), ${Number(intervalMs)});`;
        workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        worker = new Worker(workerUrl);
        worker.onmessage = () => onTick();
        worker.onerror = switchToPlainTimer;
    } catch {
        switchToPlainTimer();
    }

    return () => {
        stopWorker();
        window.clearInterval(fallbackTimer);
    };
}
