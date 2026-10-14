# Karole YouTube Controller (Chrome extension)

Plays the karaoke queue in a real YouTube window instead of the backend's video stream.
Every video that plays on youtube.com plays here, including ones that refuse to play on other
sites (Sing King karaoke videos, for example). Playback doesn't touch the backend, so YouTube's
"confirm you're not a bot" block doesn't affect it.

Install it only on the computer that drives the karaoke screen.

## Install (once, about a minute)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`frontend/karole-youtube-extension`).
4. "Karole YouTube Controller" now appears in the list. Leave it switched on.

After changing any file in this folder, click the reload arrow on the extension's card, then
reload the Karole player page. The extension takes the existing YouTube window over again
instead of opening a second one. If the player page says the YouTube window isn't responding,
click "Reconnect the YouTube window", or reload the player page.

## Using it

1. Sign in to YouTube in that Chrome. Age-restricted videos need a signed-in account, and
   YouTube Premium removes ads.
2. Open the player page at **http://localhost:3000/admin/view**. Use `localhost`, not
   `127.0.0.1`; the extension only works on the addresses listed in `manifest.json`.
3. When the page finds the extension, it says "Video plays in the YouTube window", and as soon
   as a song is up it opens a YouTube window showing only the video.
4. Drag that window onto the karaoke screen and click **Full screen** on the player page to switch it on.
5. Keep the player page open on the laptop. It's the remote, with every control in one panel:
   Back, Play/Pause, Skip, a seek bar, volume and mute, slower/faster (0.25× to 2×, click the
   speed to go back to 1×), full screen on or off, YouTube's own controls on or off, and reload. Volume,
   speed and the controls setting carry over to every song. The admin playlist page's buttons
   work too. When a song ends, the next one starts by itself.

If YouTube blocks the first song from starting with sound, click once on the video in the
YouTube window; later songs then start on their own.

Without the extension, the player page falls back to the built-in player (the backend's video
stream), exactly as before.

## Putting the site online

Add the site's address to the `"matches"` list for `site-bridge.js` in `manifest.json`, e.g.
`"https://karaoke.ubcani.com/*"`, then reload the extension.

## How it works

| File | Job |
| --- | --- |
| `site-bridge.js` | Runs on the Karole site and passes messages between the player page and the extension. |
| `background.js` | Opens the YouTube window (one only), points it at each song, and relays commands and status. |
| `youtube-player.js` | Runs on youtube.com, but only takes over the window the extension opened: it hides everything but the video, turns off YouTube's "autoplay next", applies play/pause, and reports what's playing. |
| `youtube-main.js` | Runs inside YouTube's own page so it can use YouTube's player controls (`playVideo`, `pauseVideo`, `seekTo`). Jumping by setting the video's time directly makes YouTube's player stall. |

Ads are left alone: while one plays the player page shows "Ad playing" and waits.
