# Karole YouTube Controller (Firefox)

The Firefox version of `../karole-youtube-extension`: it plays the karaoke queue in a real
YouTube window, controlled from the player page at `/admin/view`. Everything in that folder's
README about using it applies here too.

This copy uses Manifest V2 and needs Firefox 115 or newer (Firefox menu > Help > About Firefox
shows the version and updates it).

## Install

- **Try it now (until Firefox closes):** go to `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on...** and choose `manifest.json` in this folder. Firefox removes it
  when it quits, so this is the way to test, or to use it for one night.
- **Keep it installed:** Firefox only keeps add-ons signed by Mozilla. Make a zip of this
  folder's contents (in Terminal, from this folder:
  `zip -r ../karole-youtube-extension-firefox.zip . -x ".*" "README.md"`), sign in at
  https://addons.mozilla.org/developers/, choose **Submit a New Add-on**, pick **On your own**
  (unlisted, so it never appears in the store) and upload the zip. Signing is free and
  automatic; download the signed `.xpi` it gives back and open it in Firefox to install.
  Each new version needs uploading again, with a higher `version` in `manifest.json`.

If the player page doesn't find the extension, open `about:addons`, click the extension, open
**Permissions** and make sure the Karole site and youtube.com are allowed.

## Letting songs start without a click

Firefox blocks videos from starting with sound until someone clicks in the page. To lift that
for YouTube: open youtube.com, click the permissions icon left of the address, and set
**Autoplay** to **Allow Audio and Video**. Every song then starts the moment the window opens.

## How it differs from the Chrome version

| File | Difference |
| --- | --- |
| `manifest.json` | Manifest V2: a background script instead of a service worker, and Firefox's add-on id. |
| `youtube-main-loader.js` | Only here. V2 can't run a content script inside YouTube's own page, so this adds `youtube-main.js` to the page as a `<script>`. |
| `background.js`, `site-bridge.js`, `youtube-player.js` | Same as Chrome's, but call `browser.` instead of `chrome.` (Firefox's `chrome.` calls don't return promises). |
| `youtube-main.js` | Identical. |

When changing a script, make the same change in the Chrome folder.
