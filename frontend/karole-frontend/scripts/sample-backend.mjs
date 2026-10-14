// A stand-in for the real backend, so the frontend can be clicked through without
// MongoDB or YouTube. Everything lives in memory and resets when it stops.
// Run with: npm run sample-backend   (admin login: admin / karole)
import http from "node:http";

const PORT = 8000;
const ADMIN = { username: "admin", password: "karole" };
const COOKIE = "karole_sample_admin";
const MAX_SECONDS = 7 * 60;

let nextSongId = 1;
let songs = [];
let current = 0;
let playing = false;

function addSong({ url, name, author }, title, seconds) {
    const song = {
        p_id: nextSongId++,
        order_num: songs.length,
        url,
        url_id: new URL(url).searchParams.get("v"),
        name,
        author,
        url_title: title,
        url_creator: `${author} Official`,
        url_channel_icon: "",
        duration: seconds,
        is_too_long: seconds > MAX_SECONDS,
    };
    songs.push(song);
    return song;
}

// Real YouTube videos, so the YouTube window player can be tried out. Ed Sheeran is a Sing King
// karaoke video, which refuses to play anywhere but youtube.com itself.
[
    ["Aiko", "LiSA", "LiSA - Gurenge (Music Clip)", 236, "x1FV6IrjZCY"],
    ["Ben", "YOASOBI", "YOASOBI - Idol (Official Music Video)", 226, "ZRtdQ81jPUQ"],
    ["Chen Wei", "Ed Sheeran", "Ed Sheeran - Perfect (Karaoke Version)", 296, "sPMA1tqWuf4"],
    ["Dana", "Ikimonogakari", "Bluebird - Ikimonogakari (Romaji Karaoke)", 222, "naKStyMjOwM"],
    ["Eli", "KANA-BOON", "Silhouette - KANA-BOON (Romaji Karaoke)", 240, "XUlSt_HXdgU"],
].forEach(([name, author, title, seconds, id]) =>
    addSong({ url: `https://www.youtube.com/watch?v=${id}`, name, author }, title, seconds));

let nextNameId = 1;
let names = [
    { name: "Aiko", name_alt: ["Aiko S", "aiko"], blacklist: false },
    { name: "Ben", name_alt: [], blacklist: false },
    { name: "Chen Wei", name_alt: ["Chen"], blacklist: false },
    { name: "Troll", name_alt: [], blacklist: true },
].map((entry) => ({ name_id: nextNameId++, ...entry }));

let nextOperationId = 1;
let operations = [
    { name: "Dana", name_alt: "Danna", score: 90.9 },
    { name: "Eli", name_alt: "Ellie", score: 72.7 },
].map((entry) => ({ po_id: nextOperationId++, ...entry }));

function renumber() {
    songs.forEach((song, index) => { song.order_num = index; });
    current = Math.min(current, Math.max(songs.length - 1, 0));
}

function playback() {
    return { playing: playing && songs.length > 0, song: songs[current] ?? null };
}

function send(res, req, status, body, headers = {}) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        ...headers,
    });
    res.end(body === undefined ? "" : JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve) => {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk; });
        req.on("end", () => {
            if (!raw) return resolve({});
            if ((req.headers["content-type"] || "").includes("x-www-form-urlencoded")) {
                return resolve(Object.fromEntries(new URLSearchParams(raw)));
            }
            try { resolve(JSON.parse(raw)); } catch { resolve({}); }
        });
    });
}

function titleFromUrl(url) {
    const id = new URL(url).searchParams.get("v") || url.split("/").pop();
    return `Sample song (${id})`;
}

const findName = (name) => names.find((entry) => entry.name === name);

const routes = {
    // Public
    "GET /playlist/": () => [200, songs],
    "GET /playlist/now-playing": () => [200, songs[current] ?? null],
    "GET /playlist/queue-finished": () => [200, false],
    "POST /playlist/add": ({ body }) => {
        if (!body.url || !body.name || !body.author) return [422, { detail: "Please fill in every field." }];
        try { new URL(body.url); } catch { return [422, { detail: "That doesn't look like a link." }]; }
        if (findName(body.name)?.blacklist) return [403, { detail: "This name is not allowed to add songs." }];
        return [200, addSong(body, titleFromUrl(body.url), 180 + Math.floor(Math.random() * 120))];
    },

    // Admin login
    "POST /auth/login": ({ body }) => {
        if (body.username !== ADMIN.username || body.password !== ADMIN.password) {
            return [401, { detail: "Wrong username or password" }];
        }
        return [200, { message: "Logged in" }, { "Set-Cookie": `${COOKIE}=1; HttpOnly; Path=/; SameSite=Lax` }];
    },
    "POST /auth/logout": () => [200, { message: "Logged out" }, { "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/` }],

    // Admin: playback
    "GET /playlist/current-play": () => [200, playback()],
    "GET /playlist/playback-stream": () => [404, { detail: "The sample backend has no video." }],
    "POST /playlist/play_pause": () => { playing = !playing && songs.length > 0; return [200, playing]; },
    "POST /playlist/skip": () => { current = Math.min(current + 1, Math.max(songs.length - 1, 0)); return [200, playback()]; },
    "POST /playlist/back": () => { current = Math.max(current - 1, 0); return [200, playback()]; },
    "POST /playlist/jump": ({ body }) => {
        if (!songs[body.order_num]) return [404, { detail: "No song at that position" }];
        current = body.order_num;
        playing = true;
        return [200, playback()];
    },

    // Admin: queue
    "POST /playlist/move": ({ body }) => {
        const from = songs.findIndex((song) => song.p_id === body.p_id);
        if (from < 0 || !songs[body.order_num]) return [404, { detail: "Song not found" }];
        const [song] = songs.splice(from, 1);
        songs.splice(body.order_num, 0, song);
        renumber();
        return [200, song];
    },
    "POST /playlist/swap": ({ body }) => {
        if (!songs[body.original] || !songs[body.swap]) return [404, { detail: "Song not found" }];
        [songs[body.original], songs[body.swap]] = [songs[body.swap], songs[body.original]];
        renumber();
        return [200, [songs[body.swap], songs[body.original]]];
    },
    "DELETE /playlist/delete": ({ query }) => {
        const index = songs.findIndex((song) => song.p_id === Number(query.get("playlist_id")));
        if (index < 0) return [404, { detail: "Song not found" }];
        const [song] = songs.splice(index, 1);
        renumber();
        return [200, song];
    },
    "POST /playlist/keep": ({ query }) => {
        const song = songs.find((entry) => entry.p_id === Number(query.get("playlist_id")));
        if (!song) return [404, { detail: "Song not found" }];
        song.is_too_long = false;
        return [200, song];
    },
    "DELETE /playlist/flush": () => { songs = []; current = 0; playing = false; return [200, { message: "Playlist flushed" }]; },

    // Admin: names
    "GET /names/": () => [200, names],
    "PUT /names/add": ({ body }) => {
        if (findName(body.name)) return [200, { found: true }];
        names.push({ name_id: nextNameId++, name: body.name, name_alt: [], blacklist: false });
        return [200, { found: false }];
    },
    "POST /names/to_alt": ({ body }) => {
        const target = findName(body.name);
        const moved = findName(body.name_alt);
        if (!target || !moved) return [404, { detail: "Name not found" }];
        target.name_alt.push(moved.name, ...moved.name_alt);
        names = names.filter((entry) => entry !== moved);
        return [200, target];
    },
    "POST /names/to_name": ({ body }) => {
        const owner = names.find((entry) => entry.name_alt.includes(body.name));
        if (!owner) return [404, { detail: "Alternate name not found" }];
        owner.name_alt = owner.name_alt.filter((alternate) => alternate !== body.name);
        names.push({ name_id: nextNameId++, name: body.name, name_alt: [], blacklist: false });
        return [200, { name: body.name }];
    },
    "POST /names/blacklist": ({ body }) => {
        const entry = findName(body.name);
        if (!entry) return [404, { detail: "Only a primary name can be blacklisted" }];
        entry.blacklist = true;
        return [200, entry];
    },
    "POST /names/unblacklist": ({ body }) => {
        const entry = findName(body.name);
        if (!entry) return [404, { detail: "Only a primary name can be unblacklisted" }];
        entry.blacklist = false;
        return [200, entry];
    },
    "DELETE /names/delete": ({ body }) => {
        const owner = names.find((entry) => entry.name_alt.includes(body.name));
        if (owner) {
            owner.name_alt = owner.name_alt.filter((alternate) => alternate !== body.name);
        } else {
            names = names.filter((entry) => entry.name !== body.name);
        }
        return [200, { name: body.name }];
    },
    "DELETE /names/flush": () => { names = []; return [200, { message: "Names flushed" }]; },

    // Admin: pending operations
    "GET /operation/": () => [200, operations],
    "POST /operation/handle": ({ body }) => {
        const operation = operations.find((entry) => entry.po_id === body.po_id);
        if (!operation) return [404, { detail: "Operation not found" }];
        findName(operation.name)?.name_alt.push(operation.name_alt);
        operations = operations.filter((entry) => entry !== operation);
        return [200, operation];
    },
    "POST /operation/handle_all": () => {
        const handled = operations;
        handled.forEach((operation) => findName(operation.name)?.name_alt.push(operation.name_alt));
        operations = [];
        return [200, handled];
    },
    "DELETE /operation/delete": ({ body }) => {
        operations = operations.filter((entry) => entry.po_id !== body.po_id);
        return [200, { po_id: body.po_id }];
    },
    "DELETE /operation/flush": () => { operations = []; return [200, { message: "Operations flushed" }]; },
};

const PUBLIC = new Set([
    "GET /playlist/",
    "GET /playlist/now-playing",
    "GET /playlist/queue-finished",
    "POST /playlist/add",
    "POST /auth/login",
    "POST /auth/logout",
]);

http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, req, 204);
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) return send(res, req, 404, { detail: `No sample route for ${key}` });
    if (!PUBLIC.has(key) && !(req.headers.cookie || "").includes(`${COOKIE}=1`)) {
        return send(res, req, 401, { detail: "Not logged in" });
    }
    const [status, body, headers] = handler({ body: await readBody(req), query: url.searchParams });
    send(res, req, status, body, headers);
}).listen(PORT, () => {
    console.log(`Sample backend on http://localhost:${PORT} (admin login: ${ADMIN.username} / ${ADMIN.password})`);
});
