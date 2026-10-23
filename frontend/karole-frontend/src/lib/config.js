// The browser talks to the backend through this site: everything under /backend is passed on
// to it (see app/backend/[...path]/route.js). Being the site's own address, it works from
// phones on the same Wi-Fi, and the admin login cookie belongs to the site.
export const BACKEND_URI = "/backend";
