// Plays the backend's video stream so the admin can jump to any point in the song.
//
// The backend sends each song as one long fragmented MP4 with no byte ranges, so a plain
// <video src> can only play forward. Instead, the video is fed through Media Source
// Extensions: the song downloads in the background, anything downloaded can be jumped to,
// and a jump past the download asks the backend for a new stream starting at that point
// (playback-stream?start=<seconds>), which is placed at the right spot on the timeline.

// Chrome keeps at most about 150 MB per video buffer; older video behind this many
// seconds is dropped to make room when a long song gets close to that.
const KEEP_BEHIND_SECONDS = 30;
// A jump this close past the part being downloaded just waits for it instead of restarting.
const WAIT_AHEAD_SECONDS = 8;

const ascii = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const hex = (byte) => byte.toString(16).padStart(2, "0");

function concat(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
    }
    return joined;
}

function findBox(bytes, name, from = 0) {
    for (let index = from; index + 4 <= bytes.length; index++) {
        if (ascii(bytes, index) === name) return index;
    }
    return -1;
}

// Lists the child boxes of the box starting at `at` (or of the whole buffer).
function children(bytes, at = -8, end = bytes.length) {
    const view = viewOf(bytes);
    const list = [];
    for (let child = at + 8; child + 8 <= end;) {
        const size = view.getUint32(child);
        if (size < 8 || child + size > end) break;
        list.push({ at: child, size, type: ascii(bytes, child + 4) });
        child += size;
    }
    return list;
}

// Reads which codecs the stream uses from its header ("moov"), because a media buffer
// has to be created for the exact video and audio codecs.
export function detectCodecs(bytes) {
    const codecs = [];
    const avcC = findBox(bytes, "avcC");
    if (avcC >= 0 && avcC + 8 <= bytes.length) {
        codecs.push(`avc1.${hex(bytes[avcC + 5])}${hex(bytes[avcC + 6])}${hex(bytes[avcC + 7])}`);
    } else if (findBox(bytes, "vp09") >= 0) {
        codecs.push("vp09.00.10.08");
    } else if (findBox(bytes, "av01") >= 0) {
        codecs.push("av01.0.05M.08");
    }
    if (findBox(bytes, "mp4a") >= 0) {
        codecs.push("mp4a.40.2");
    } else if (findBox(bytes, "Opus") >= 0) {
        codecs.push("opus");
    }
    return codecs.length > 0 ? `video/mp4; codecs="${codecs.join(", ")}"` : null;
}

// A stream that starts partway through says where each track really starts with MP4 edit
// lists ("elst"): an empty edit of N seconds, then the media from time M. Browsers don't
// apply those reliably, so this reads them into per-track shifts (in the track's own time
// units) for fixFragment to apply, and returns the header with the edit lists removed.
function readHeader(moov) {
    const view = viewOf(moov);
    let movieTimescale = 1000;
    const shifts = new Map();
    const removals = [];

    for (const box of children(moov, 0)) {
        if (box.type === "mvhd") {
            movieTimescale = view.getUint32(box.at + (moov[box.at + 8] === 1 ? 28 : 20));
        }
        if (box.type !== "trak") continue;
        let trackId = null;
        let timescale = null;
        let emptySeconds = 0;
        let mediaTime = 0;
        for (const part of children(moov, box.at, box.at + box.size)) {
            if (part.type === "tkhd") {
                trackId = view.getUint32(part.at + (moov[part.at + 8] === 1 ? 28 : 20));
            } else if (part.type === "edts") {
                removals.push({ at: part.at, size: part.size, trak: box.at });
                const elst = children(moov, part.at, part.at + part.size).find((entry) => entry.type === "elst");
                if (!elst) continue;
                const version = moov[elst.at + 8];
                const count = view.getUint32(elst.at + 12);
                let entry = elst.at + 16;
                for (let index = 0; index < count; index++) {
                    const duration = version === 1 ? Number(view.getBigUint64(entry)) : view.getUint32(entry);
                    const time = version === 1 ? Number(view.getBigInt64(entry + 8)) : view.getInt32(entry + 4);
                    if (time === -1) {
                        emptySeconds += duration / movieTimescale;
                    } else {
                        mediaTime = time;
                        break;
                    }
                    entry += version === 1 ? 20 : 12;
                }
            } else if (part.type === "mdia") {
                const mdhd = children(moov, part.at, part.at + part.size).find((entry) => entry.type === "mdhd");
                if (mdhd) timescale = view.getUint32(mdhd.at + (moov[mdhd.at + 8] === 1 ? 28 : 20));
            }
        }
        if (trackId !== null && timescale) {
            shifts.set(trackId, Math.round(emptySeconds * timescale) - mediaTime);
        }
    }

    if (removals.length === 0) return { moov, shifts };
    // Cut the edit list boxes out and shrink the boxes that held them.
    const fixed = moov.slice();
    const fixedView = viewOf(fixed);
    for (const removal of removals) {
        fixedView.setUint32(removal.trak, fixedView.getUint32(removal.trak) - removal.size);
        fixedView.setUint32(0, fixedView.getUint32(0) - removal.size);
    }
    const pieces = [];
    let from = 0;
    for (const removal of removals.sort((first, second) => first.at - second.at)) {
        pieces.push(fixed.subarray(from, removal.at));
        from = removal.at + removal.size;
    }
    pieces.push(fixed.subarray(from));
    return { moov: concat(pieces), shifts };
}

// ffmpeg marks each fragment's position with an absolute byte offset in the file
// ("base-data-offset" in each "tfhd" box). Media Source Extensions refuse that and want
// offsets counted from the start of the fragment ("default-base-is-moof"), so this drops
// the 8-byte offset, sets the flag and shifts the sample data offsets (in "trun") to match.
// It also moves each track's decode time ("tfdt") by its shift from readHeader.
// `moofStart` is where the box began in the original stream.
function fixFragment(box, moofStart, shifts) {
    const bytes = box.slice();
    const view = viewOf(bytes);
    const removals = [];
    const trafs = [];
    for (const traf of children(bytes, 0).filter((child) => child.type === "traf")) {
        const info = { at: traf.at, base: null, tfhd: -1, tfdt: -1, shift: 0, truns: [] };
        for (const part of children(bytes, traf.at, traf.at + traf.size)) {
            if (part.type === "tfhd") {
                info.shift = shifts.get(view.getUint32(part.at + 12)) || 0;
                if (view.getUint32(part.at + 8) & 0x000001) {
                    info.base = Number(view.getBigUint64(part.at + 16));
                    info.tfhd = part.at;
                    removals.push(part.at + 16);
                }
            } else if (part.type === "tfdt") {
                info.tfdt = part.at;
            } else if (part.type === "trun") {
                info.truns.push(part.at);
            }
        }
        trafs.push(info);
    }

    const removed = 8 * removals.length;
    for (const traf of trafs) {
        if (traf.tfdt >= 0 && traf.shift) {
            if (bytes[traf.tfdt + 8] === 1) {
                const time = view.getBigUint64(traf.tfdt + 12) + BigInt(traf.shift);
                view.setBigUint64(traf.tfdt + 12, time > 0n ? time : 0n);
            } else {
                view.setUint32(traf.tfdt + 12, Math.max(0, view.getUint32(traf.tfdt + 12) + traf.shift));
            }
        }
        if (traf.base === null) continue;
        const versionAndFlags = view.getUint32(traf.tfhd + 8);
        const flags = ((versionAndFlags & 0xffffff) & ~0x000001) | 0x020000;
        view.setUint32(traf.tfhd + 8, (versionAndFlags & 0xff000000) | flags);
        view.setUint32(traf.tfhd, view.getUint32(traf.tfhd) - 8);
        view.setUint32(traf.at, view.getUint32(traf.at) - 8);
        for (const trun of traf.truns) {
            if (view.getUint32(trun + 8) & 0x000001) {
                const dataOffset = view.getInt32(trun + 16);
                view.setInt32(trun + 16, traf.base + dataOffset - moofStart - removed);
            }
        }
    }
    if (removed === 0) return bytes;
    view.setUint32(0, view.getUint32(0) - removed);

    const fixed = new Uint8Array(bytes.length - removed);
    let written = 0;
    let from = 0;
    for (const at of removals) {
        fixed.set(bytes.subarray(from, at), written);
        written += at - from;
        from = at + 8;
    }
    fixed.set(bytes.subarray(from), written);
    return fixed;
}

// Splits incoming bytes into MP4 boxes, fixing the header and each fragment on the way.
// Sample data ("mdat") is passed straight through without waiting for the whole box.
function createFragmentFixer() {
    let pending = new Uint8Array(0);
    let offset = 0;
    let passThrough = 0;
    let shifts = new Map();

    return function push(chunk) {
        const out = [];
        pending = pending.length > 0 ? concat([pending, chunk]) : chunk;
        while (pending.length > 0) {
            if (passThrough > 0) {
                const length = Math.min(passThrough, pending.length);
                out.push({ type: "data", bytes: pending.subarray(0, length) });
                passThrough -= length;
                offset += length;
                pending = pending.subarray(length);
                continue;
            }
            if (pending.length < 8) break;
            const view = viewOf(pending);
            let size = view.getUint32(0);
            const type = ascii(pending, 4);
            let headerLength = 8;
            if (size === 1) {
                if (pending.length < 16) break;
                size = Number(view.getBigUint64(8));
                headerLength = 16;
            }
            if (type === "mdat") {
                out.push({ type, bytes: pending.subarray(0, headerLength) });
                passThrough = size === 0 ? Infinity : size - headerLength;
                offset += headerLength;
                pending = pending.subarray(headerLength);
                continue;
            }
            if (size === 0 || pending.length < size) break;
            let box = pending.subarray(0, size);
            if (type === "moov") {
                const header = readHeader(box);
                box = header.moov;
                shifts = header.shifts;
            } else if (type === "moof") {
                box = fixFragment(box, offset, shifts);
            }
            out.push({ type, bytes: box });
            offset += size;
            pending = pending.subarray(size);
        }
        return out;
    };
}

function waitFor(target, eventName) {
    return new Promise((resolve) => target.addEventListener(eventName, resolve, { once: true }));
}

function rangesOf(video) {
    const ranges = [];
    for (let index = 0; index < video.buffered.length; index++) {
        ranges.push({ start: video.buffered.start(index), end: video.buffered.end(index) });
    }
    return ranges;
}

// The downloaded stretch of video that includes `time`, if any.
export function rangeAt(video, time) {
    return rangesOf(video).find((range) => range.start <= time + 0.1 && time < range.end) || null;
}

// Starts playback of `url` in `video`. Returns a function that stops all downloads.
// `durationHint` (seconds) lets the seek bar show the full length before the download ends.
// `onFallback` is called when this browser can't do it, after switching to a plain stream.
export function attachSeekableStream(video, url, { durationHint, onFallback } = {}) {
    const MediaSourceType = window.ManagedMediaSource || window.MediaSource;
    if (!MediaSourceType) {
        video.src = url;
        onFallback?.("This browser can't buffer the whole video, so jumping ahead is limited.");
        return () => {};
    }

    const mediaSource = new MediaSourceType();
    const objectUrl = URL.createObjectURL(mediaSource);
    let stopped = false;
    let buffer = null;
    let current = null; // the stream being downloaded: { controller, start }
    let songEnd = null; // set once a download has reached the end of the song

    // Safari's ManagedMediaSource only streams when remote playback is turned off.
    video.disableRemotePlayback = true;
    video.src = objectUrl;

    function fallBack(reason) {
        if (stopped) return;
        stop();
        video.src = url;
        onFallback?.(reason);
    }

    async function append(chunk, controller) {
        while (!controller.signal.aborted) {
            try {
                buffer.appendBuffer(chunk);
                await waitFor(buffer, "updateend");
                return;
            } catch (error) {
                if (error.name !== "QuotaExceededError") throw error;
                // Out of room: drop video already watched, or wait for playback to move on.
                const keepFrom = video.currentTime - KEEP_BEHIND_SECONDS;
                const ranges = rangesOf(video);
                const start = ranges.length > 0 ? ranges[0].start : 0;
                if (keepFrom > start + 1) {
                    buffer.remove(start, keepFrom);
                    await waitFor(buffer, "updateend");
                } else {
                    await waitFor(video, "timeupdate");
                }
            }
        }
    }

    // How far the stream being downloaded has got.
    function frontier() {
        if (!current) return null;
        const range = rangesOf(video).find((entry) => entry.end > current.start && entry.start <= current.start + 1);
        return range ? range.end : current.start;
    }

    function finishIfComplete() {
        if (mediaSource.readyState === "open" && buffer && !buffer.updating) {
            // Sets the real duration and lets the video fire "ended" at the end.
            mediaSource.endOfStream();
        }
    }

    // After a download stops, keep filling the next missing stretch after the playhead.
    function fillNextGap() {
        if (stopped || current || songEnd === null) return;
        const here = rangeAt(video, video.currentTime);
        const gapStart = here ? here.end : video.currentTime;
        if (gapStart < songEnd - 0.5) {
            startStream(Math.floor(gapStart));
        }
    }

    async function startStream(from) {
        current?.controller.abort();
        const controller = new AbortController();
        const stream = { controller, start: from };
        current = stream;
        // Forget any half-appended data from the previous stream.
        if (buffer && mediaSource.readyState === "open") buffer.abort();

        try {
            const streamUrl = from > 0 ? `${url}?start=${from}` : url;
            const response = await fetch(streamUrl, { credentials: "include", signal: controller.signal });
            if (!response.ok || !response.body) {
                throw new Error(`Video request failed with status ${response.status}`);
            }
            const reader = response.body.getReader();
            const fixer = createFragmentFixer();
            const header = [];
            let ready = false;

            while (!controller.signal.aborted) {
                const { done, value } = await reader.read();
                if (done) {
                    // This download reached the end of the song.
                    songEnd = frontier() ?? songEnd;
                    break;
                }
                for (const piece of fixer(value)) {
                    if (controller.signal.aborted) break;
                    if (!ready) {
                        // Hold the start of the stream until its header says which codecs it uses.
                        header.push(piece.bytes);
                        if (piece.type !== "moov") continue;
                        if (!buffer) {
                            const type = detectCodecs(concat(header));
                            if (!type || !MediaSourceType.isTypeSupported(type)) {
                                fallBack("This video's format can't be buffered here, so jumping ahead is limited.");
                                return;
                            }
                            buffer = mediaSource.addSourceBuffer(type);
                            if (durationHint > 0) mediaSource.duration = durationHint;
                        }
                        ready = true;
                        await append(concat(header), controller);
                        continue;
                    }
                    await append(piece.bytes, controller);
                }
                // Stop once this download runs into video that is already there up to the end.
                if (songEnd !== null && frontier() >= songEnd - 0.25) {
                    controller.abort();
                }
            }
            if (current === stream) {
                current = null;
                if (songEnd !== null && rangeAt(video, video.currentTime)?.end >= songEnd - 0.25) {
                    finishIfComplete();
                }
                fillNextGap();
            }
        } catch (error) {
            if (controller.signal.aborted) {
                if (current === stream) {
                    current = null;
                    fillNextGap();
                }
                return;
            }
            const detail = video.error?.message || error.message;
            fallBack(`Couldn't buffer the video (${detail}), so jumping ahead is limited.`);
        }
    }

    // A jump (or playback running) into a part that isn't downloaded: either wait for the
    // download that is about to reach it, or start a new download from there.
    function onNeedData() {
        if (stopped || !buffer) return;
        const time = video.currentTime;
        if (rangeAt(video, time)) return;
        const reach = frontier();
        if (current && time >= current.start - 0.5 && reach !== null && time <= reach + WAIT_AHEAD_SECONDS) return;
        startStream(Math.max(0, Math.floor(time)));
    }

    function stop() {
        stopped = true;
        current?.controller.abort();
        current = null;
        video.removeEventListener("seeking", onNeedData);
        video.removeEventListener("waiting", onNeedData);
        URL.revokeObjectURL(objectUrl);
    }

    video.addEventListener("seeking", onNeedData);
    video.addEventListener("waiting", onNeedData);
    waitFor(mediaSource, "sourceopen").then(() => {
        if (!stopped) startStream(0);
    });

    return stop;
}
