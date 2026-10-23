// Passes every request under /backend on to the Python backend and streams its answer back,
// so browsers only ever talk to this site: phones on the same Wi-Fi (or the internet, later)
// need just the site's address, and the admin login cookie belongs to the site.
// Each request gets a connection of its own. The backend closes a connection after an
// unexpected error (such as a failed video lookup), and a reused one would then fail the next,
// unrelated request.
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { BACKEND_ADDRESSES } from "../../../lib/backend-address";

// Headers about one connection rather than the request or answer itself.
const CONNECTION_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length"]);

function send(target, options, body) {
    return new Promise((resolve, reject) => {
        const client = target.protocol === "https:" ? https : http;
        const outgoing = client.request(target, options, resolve);
        outgoing.on("error", reject);
        outgoing.end(body);
    });
}

async function passOn(request) {
    const { pathname, search } = new URL(request.url);
    const headers = {};
    request.headers.forEach((value, key) => {
        if (!CONNECTION_HEADERS.has(key)) headers[key] = value;
    });
    const body = request.method === "GET" ? null : Buffer.from(await request.arrayBuffer());
    if (body) headers["content-length"] = body.length;

    // Each address in turn, moving on only when one can't be reached at all. An error answer
    // from the backend (a 404, say) is passed on as it is.
    let answer, address;
    for (address of BACKEND_ADDRESSES) {
        const target = new URL(pathname.slice("/backend".length) + search, address);
        try {
            // signal: when the browser gives up on a request (say a video stream it no longer
            // needs), the backend's side is closed too.
            answer = await send(target, { method: request.method, headers, agent: false, signal: request.signal }, body);
            break;
        } catch {
            if (request.signal.aborted) break;
        }
    }
    if (!answer) {
        // Plain text rather than JSON: the pages treat a 5xx without the backend's JSON as
        // "the server can't be reached".
        return new Response("The backend is not reachable", { status: 502 });
    }

    const answerHeaders = new Headers();
    for (const [key, value] of Object.entries(answer.headers)) {
        if (CONNECTION_HEADERS.has(key)) continue;
        for (const each of [].concat(value)) answerHeaders.append(key, each);
    }
    // A redirect from the backend names the backend's own address; keep it under /backend.
    const location = answerHeaders.get("location");
    if (location?.startsWith(address)) {
        answerHeaders.set("location", `/backend${location.slice(address.length)}`);
    }
    const hasBody = answer.statusCode !== 204 && answer.statusCode !== 304;
    return new Response(hasBody ? Readable.toWeb(answer) : null, { status: answer.statusCode, headers: answerHeaders });
}

export { passOn as GET, passOn as POST, passOn as PUT, passOn as DELETE };
