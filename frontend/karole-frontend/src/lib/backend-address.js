// Where the Python backend runs, as seen from this site's server. Browsers never use it: they
// go through /backend (see app/backend/[...path]/route.js).
// Tried in order: the backend on this machine first (where it runs, also behind
// https://karaoke.ubcani.com), then the Tailscale address.
export const BACKEND_ADDRESSES = ["http://127.0.0.1:8000", "https://dhairyas-macbook-pro.tail512d14.ts.net:3000"];
