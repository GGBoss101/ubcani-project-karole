/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hides the round "N" Next.js dev tools button that shows while running `npm run dev`.
  devIndicators: false,
  // Backend routes such as /playlist/ end in a slash, and browsers reach them through this
  // site at /backend/playlist/ (see src/app/backend). Next.js would otherwise redirect those
  // to the address without the slash first.
  skipTrailingSlashRedirect: true,
  // `npm run dev` only serves its scripts to localhost unless an address is listed here: the
  // live site, the Tailscale Funnel address, and 127.0.0.1 on this Mac.
  allowedDevOrigins: ["karaoke.ubcani.com", "dhairyas-macbook-pro.tail512d14.ts.net", "127.0.0.1"],
};

export default nextConfig;
