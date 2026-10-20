# Karole frontend

The website for Karole, the UBCAni karaoke queue. People add YouTube songs from their
phones, everyone can watch the live queue, and the host runs playback and the queue from
the admin pages. This folder is only the website; the Python backend lives in `../../backend`.

## Tech stack

| Part | What is used | Notes |
| --- | --- | --- |
| Framework | **Next.js 16.3.5** (App Router) | Pages live in `src/app/<route>/page.js`. `npm run dev` uses Turbopack. |
| UI library | **React 19.2.8** | Every page is a client component (`"use client"`) that talks to the backend from the browser. |
| Language | **JavaScript** (no TypeScript) | `jsconfig.json` only sets up editor paths. |
| Styling | **CSS Modules** + global CSS variables | One `page.module.css` per page, shared tokens in `src/app/globals.css`. No Tailwind or UI kit. |
| Fonts | `next/font/google` | Dela Gothic One for headings, Figtree for text, the same pair as ubcani.com. |
| Linting | ESLint 9 + `eslint-config-next` | `npm run lint`. |
| Dependencies | `next`, `react`, `react-dom` only | Nothing else is installed: video handling, YouTube links and polling are written by hand in `src/lib`. |

Next.js 16 differs from older versions in places. Its own docs ship with the package in
`node_modules/next/dist/docs/`; check those before relying on older tutorials.

## Folder map

```
src/
  app/
    layout.js, globals.css      Fonts, colour tokens, shared button and placeholder styles
    page.js                     "/" just redirects to /add
    add/                        Add a song (public)
    playlist/                   Live queue (public)
    admin/
      admin.module.css          Layout, table and button styles shared by the admin pages
      login/                    Admin sign-in
      playlist/                 Run playback, reorder/delete songs, queue switch, queue time
      names/                    Manage singer names (drag, or tap on touch screens)
      operations/               Approve or ignore suggested name matches
      view/                     Full-screen video player for the karaoke screen
  components/                   Headers and the queue card (QueueItem)
  lib/                          Data hooks and helpers (see below)
scripts/sample-backend.mjs      Stand-in backend with fake data, for working without MongoDB
```

## How the pieces talk to each other

- **Backend address.** The browser only talks to this site: everything under `/backend` is
  passed on to the backend at `http://127.0.0.1:8000` (`src/app/backend/[...path]/route.js`,
  address in `src/lib/backend-address.js`). So phones on the same Wi-Fi only need the site's
  address, and the admin login cookie belongs to the site.
- **Live updates are polling, not websockets.** The queue pages refresh every 5 seconds
  (`lib/use-playlist.js`), the queue switch every 5 seconds (`lib/use-queue-settings.js`),
  and the player page asks what is playing every 0.5 seconds.
- **Admin login.** The backend sets an HttpOnly cookie, `karole_admin_token`, which page
  scripts can't read. `lib/admin-auth.js` sends it with every admin request and goes to the
  login page whenever the backend answers 401.
- **Singer names.** After someone's first song, their name is remembered in a cookie,
  `karole-user-name`, for a year, and the name field locks, so later songs count as theirs
  for queue order. A mistyped name can be merged into the right one on Admin → Names.
  The "Combine queues when merging names" checkbox appears on both the Names and Operations
  pages and shares one setting (saved per browser, on by default); Match and Match all
  follow it. The Operations page refreshes itself every few seconds and drops suggestions whose
  names were since merged, deleted or flushed; Match all skips any that no longer work.
- **Queue switch.** The backend stores `{ "open": true|false }` in MongoDB and checks it
  before inserting each song, including after the YouTube lookup finishes. Anyone can read
  the setting; only an authenticated admin can change it. The Add song form also hides while
  the queue is closed, but the backend enforces the restriction.

## Helpers in `src/lib`

| File | What it does |
| --- | --- |
| `use-playlist.js` | Loads the queue and the song playing now; returns `songs`, `upcoming`, `currentId`. |
| `use-queue-settings.js` | Reads and flips the "taking songs" switch. |
| `queue-time.js` | Adds up song lengths and formats them ("about 23 min", "1:02:05"). |
| `youtube.js` | Turns any YouTube link (Shorts, youtu.be, mobile, Music, embed, long share links) into `https://www.youtube.com/watch?v=<id>`, the only form the backend accepts. |
| `seekable-stream.js` | The video player engine, below. |
| `admin-auth.js`, `api-error.js`, `config.js` | Admin requests, readable error messages, backend address. |

## The video player

The player page (`app/admin/view`) has two modes:

- **YouTube window** (`view/window-player.js`, `lib/youtube-window.js`), used when the
  "Karole YouTube Controller" browser extension is installed (`../karole-youtube-extension` for Chrome, Edge, Brave..., `../karole-youtube-extension-firefox` for Firefox).
  Songs play in a real YouTube window, so every video works and playback never goes through
  the backend. The page is the remote. See that folder's README to install it. From extension
  1.6.0, changes made on the admin Playlist page go straight to the YouTube window and the
  extension moves the queue on when a song ends, so neither waits for this page, which the
  browser may have frozen in a background tab.
- **Built-in player** (`view/stream-player.js`), used otherwise: it plays the backend's stream.

### The built-in player (`lib/seekable-stream.js`)

The backend sends each song as one continuous MP4 made by ffmpeg, which a plain `<video>`
can only play forwards. The player instead uses **Media Source Extensions**:

1. It downloads the stream and feeds it to the video in pieces.
2. It rewrites two things ffmpeg writes that browsers refuse in this mode: absolute byte
   offsets in each fragment header, and (for streams that start mid-song) edit lists.
3. A jump past what has downloaded requests `playback-stream?start=<seconds>` from the
   backend and places that piece at the right point on the timeline.
4. When a download finishes, it fills in any skipped stretch after the playhead.

If a browser can't do this, it falls back to plain forward-only playback and says so.

## Design system

- Colours are ubcani.com's own tokens (navy `#0f125b`, pink, yellow, aqua, light blue,
  light grey), defined once in `globals.css`. Surfaces and lines are tints of those.
- `.button-primary` is the light-grey pill button; `.image-placeholder` is the striped box
  standing in for artwork until real images exist.
- Mobile first: every control is at least 44 px tall on touch screens, spacing respects the
  iPhone notch, and admin tables turn into cards below 720 px wide.

## Running it

Three things run together: MongoDB, the backend (port 8000) and this site (port 3000).

```bash
brew services run mongodb/brew/mongodb-community
cd backend && .venv/bin/uvicorn main:app --port 8000
cd frontend/karole-frontend && npm run dev
```

Then open http://localhost:3000. Admin pages are under `/admin/login`.

| Command | Use |
| --- | --- |
| `npm run dev` | Development server with live reload. |
| `npm run build` then `npm start` | Production build, for real events. |
| `npm run lint` | Check the code. |
| `npm run sample-backend` | Fake backend on port 8000 (admin password `karole`), when MongoDB isn't set up. |

## Restoring a previous playlist session

If the backend stops (a crash, a restart, the laptop shutting down), the queue is empty when it
comes back. The previous queue can be brought back from the admin Playlist page.

### How to restore

1. Start the backend again (see "Running it") and open **/admin/playlist**.
2. If the playlist isn't empty, click **Flush playlist database** at the bottom first. Restoring
   replaces the whole queue, so it only works on an empty one.
3. In **Restore a previous session**, click **Show previous sessions**.
4. Pick a session from the menu. Each one shows when it ended, how many songs it had, how many had
   been sung, and the song it was on, e.g. `Oct 18, 1:51 AM · 4 songs (1 sung) · on "seasons"`.
   The newest is at the top, and that's normally the one the server was running when it stopped.
5. Click **Restore** and confirm. The songs, their order and the current song come back exactly
   as they were. Playback is **paused**: press Play when you're ready.

People can carry on adding songs straight away; new songs line up after the restored ones as
usual. Restoring is itself logged, so it's safe to restore again later if needed.

Restored songs are matched by name to the current names list (main or alternate names), and a
restore never changes the names already there. A name that isn't there yet is added just as when
a singer adds a song, with the usual suggestion on Operations if it is close to an existing one,
so it's safe to clear the names first. The queue comes back in its saved order; if two of its
names are one person in the names list now, that person's next new song counts all their songs.

### How the playlist is stored

- While the backend runs, the queue lives only in its memory (`backend/playlist/playlist_store.py`).
- After every change (a song added, deleted, moved, skipped, play/pause, a name merge, a flush,
  a restore) the backend adds one line to `backend/playlist/playlist_log.jsonl`. Each line is a
  complete snapshot in JSON: the time, whether it was playing, the current song, whether the queue
  had run out, and every song with all its details (singer, song name, YouTube title and link,
  length, place in line...). Nothing is ever overwritten; the file only grows.
- A **session** is a run of snapshots that ends when the playlist is emptied (flush, or its last
  song deleted) or the server restarts. The menu offers the last snapshot of each session (up to 30).
- The log isn't committed to git (it's in `.gitignore`) and stays on the computer running the
  backend. Copy it somewhere to keep a backup; deleting it removes every restore point.
- Names and songs blocked for being too long are in MongoDB, not the log, so they survive restarts
  on their own and still match a restored queue.
- Older log lines use the field names from before the rename (`author`, `url_title`); restoring
  converts them, so older sessions restore too.

Behind the page: `GET /playlist/sessions` lists the sessions and `POST /playlist/restore?line=N`
restores the one ending on line N of the log (both need the admin login).

## Known limits

- The backend keeps the queue in memory, so restarting it empties the queue. It can be restored
  from the admin Playlist page (see "Restoring a previous playlist session").
- YouTube sometimes blocks the backend's lookups ("confirm you're not a bot"). Giving the
  backend a cookies file through `YTDLP_COOKIE_FILE` in `backend/.env` lets yt-dlp retry failed
  lookups using that authenticated session. Normal lookups are attempted first.
- The queue switch only hides the form; someone calling the backend directly could still add songs.
- Going online: the backend should stay on a home or campus connection (YouTube blocks cloud
  servers), published with something like Cloudflare Tunnel. The site already passes backend requests
  through itself, so only the site needs to be published.
