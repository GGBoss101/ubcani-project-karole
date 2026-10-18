// Where the Python backend runs, as seen from this site's server. Browsers never use it: they
// go through /backend (see app/backend/[...path]/route.js).
// Tried in order: the Tailscale address first, then the backend directly on this machine if
// that can't be reached (say Tailscale is off).
export const BACKEND_ADDRESSES = ["https://dhairyas-macbook-pro.tail512d14.ts.net:3000", "http://127.0.0.1:8000"];
