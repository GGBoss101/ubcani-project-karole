/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hides the round "N" Next.js dev tools button that shows while running `npm run dev`.
  devIndicators: false,
  // Backend routes such as /playlist/ end in a slash, and browsers reach them through this
  // site at /backend/playlist/ (see src/app/backend). Next.js would otherwise redirect those
  // to the address without the slash first.
  skipTrailingSlashRedirect: true,
  // `npm run dev` only serves its scripts to localhost unless an address is listed here: the
  // site is shared over Tailscale Funnel at the first, and opened as 127.0.0.1 on this Mac.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
