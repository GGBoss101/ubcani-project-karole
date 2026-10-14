// Whether the queue is taking new songs. The backend has no such setting, so the site keeps
// it in a small file next to itself. The Add song page hides its form while it is closed.
// Note this is a switch for the site, not a lock: the backend itself still accepts songs.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SETTINGS_FILE = path.join(process.cwd(), ".karole-settings.json");
// The admin login cookie set by the backend; browsers send it to every localhost port.
const ADMIN_COOKIE = "karole_admin_token";
const BACKEND_URI = "http://127.0.0.1:8000";

async function readSettings() {
    try {
        return { open: true, ...JSON.parse(await readFile(SETTINGS_FILE, "utf8")) };
    } catch {
        return { open: true };
    }
}

export async function GET() {
    return Response.json(await readSettings());
}

export async function POST(request) {
    // Only a logged-in admin may change it: ask the backend whether the login is valid.
    const token = request.cookies.get(ADMIN_COOKIE)?.value;
    if (!token) {
        return Response.json({ detail: "Not logged in" }, { status: 401 });
    }
    try {
        const check = await fetch(`${BACKEND_URI}/playlist/current-play`, {
            headers: { Cookie: `${ADMIN_COOKIE}=${token}` },
            cache: "no-store",
        });
        if (!check.ok) {
            return Response.json({ detail: "Not logged in" }, { status: 401 });
        }
    } catch {
        return Response.json({ detail: "The backend is not reachable" }, { status: 502 });
    }

    const body = await request.json().catch(() => null);
    if (typeof body?.open !== "boolean") {
        return Response.json({ detail: "Send { open: true } or { open: false }" }, { status: 422 });
    }
    const settings = { ...(await readSettings()), open: body.open };
    await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return Response.json(settings);
}
