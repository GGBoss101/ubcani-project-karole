from models import PlaylistInput, NameInput, PlaylistEntry, PlaylistSwap, PlaylistMove, PlaylistJump
from fastapi import APIRouter, Depends, HTTPException, status
from name import name
from playlist.playlist_store import playlist_store
import asyncio
import os
import time
from typing import Any, cast
from html.parser import HTMLParser
from urllib.request import Request as UrlRequest, urlopen
from yt_dlp import YoutubeDL
from auth import require_admin
from fastapi.responses import StreamingResponse

router = APIRouter(
    prefix="/playlist",
    tags=["playlist"],
    responses={404: {"description": "Not found"}}
)

# Songs longer than this are still added, but flagged so the admin can skip them.
max_song_length_seconds = os.getenv("MAX_SONG_LENGTH_SECONDS")

if (max_song_length_seconds != None):
    max_song_length_seconds = int(max_song_length_seconds)
else:
    max_song_length_seconds = 600

# YouTube stream URLs expire after about six hours, so a lookup is only reused for one.
PLAYBACK_CACHE_SECONDS = 3600
# Stream URLs already looked up, by song URL: {"time": ..., "formats": ...}.
playback_formats_cache: dict[str, dict] = {}
# Keeps a reference to running prefetch tasks so they are not garbage collected midway.
prefetch_tasks: set[asyncio.Task] = set()

def extract_video_info(url: str) -> dict:
    options = _yt_dlp_options()
    with YoutubeDL(cast(Any, options)) as downloader:
        return cast(dict, downloader.extract_info(url, download=False))

def extract_playback_url(url: str) -> str | None:
    options = _yt_dlp_options()
    options["format"] = "best[ext=mp4]/best"
    with YoutubeDL(cast(Any, options)) as downloader:
        video_info = cast(dict, downloader.extract_info(url, download=False))
    return video_info.get("url")

def extract_playback_formats(url: str) -> tuple[str, str | None]:
    options = _yt_dlp_options()
    # 1080p H.264 with AAC audio: every browser decodes it in hardware. Plain "bestvideo"
    # picks 4K AV1 when a video has it, which stutters and uses three times the bandwidth.
    options["format"] = "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    with YoutubeDL(cast(Any, options)) as downloader:
        video_info = cast(dict, downloader.extract_info(url, download=False))
    requested_formats = video_info.get("requested_formats") or []
    if len(requested_formats) >= 2:
        return requested_formats[0]["url"], requested_formats[1]["url"]
    if video_info.get("url"):
        return video_info["url"], None
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="No playable video stream was found",
    )

def _yt_dlp_options() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        # A watch URL with a "list=" parameter would otherwise be read as the whole playlist.
        "noplaylist": True,
    }
    cookie_file = os.getenv("YTDLP_COOKIE_FILE")
    if cookie_file and os.path.exists(cookie_file):
        opts["cookiefile"] = cookie_file
    return opts

class ChannelIconParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icon_url: str | None = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "meta" and attributes.get("property") == "og:image":
            self.icon_url = attributes.get("content")
        elif tag == "link" and attributes.get("rel") == "image_src":
            self.icon_url = attributes.get("href")

def extract_channel_icon_url(channel_url: str | None) -> str | None:
    if not channel_url:
        return None

    request = UrlRequest(channel_url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urlopen(request, timeout=10) as response:
            parser = ChannelIconParser()
            parser.feed(response.read().decode("utf-8", errors="ignore"))
            return parser.icon_url
    except OSError:
        return None

# The yt-dlp and channel icon lookups take seconds, so the routes below run them
# with asyncio.to_thread to keep the server answering other requests meanwhile.

async def get_playback_formats(url: str) -> tuple[str, str | None]:
    cached = playback_formats_cache.get(url)
    if cached is not None and time.time() - cached["time"] < PLAYBACK_CACHE_SECONDS:
        return cached["formats"]
    formats = await asyncio.to_thread(extract_playback_formats, url)
    playback_formats_cache[url] = {"time": time.time(), "formats": formats}
    return formats

async def prefetch_playback_formats(url: str) -> None:
    try:
        await get_playback_formats(url)
    except Exception:
        # Only a head start: the lookup runs again, and reports its error, when the song starts.
        pass

@router.post("/add")
async def add_song(body: PlaylistInput):
    date = time.time()

    if playlist_store.find_song_by_url(body.service, body.url_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Song exists in playlist")

    video_info = await asyncio.to_thread(extract_video_info, body.url)
    channel_icon_url = await asyncio.to_thread(
        extract_channel_icon_url,
        video_info.get("channel_url") or video_info.get("uploader_url"),
    )
    name_result = await name.read_name(NameInput(name=body.name))
    if name_result["entry"].blacklist:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This name is blacklisted")
    # yt-dlp reports no duration for some videos, such as live streams.
    duration = video_info.get("duration")
    playlist_entry = {
        "name_id": name_result["entry"].name_id,
        "time": date,
        "name": name_result["entry"].name,
        "author": body.author,
        "service": body.service,
        "url": body.url,
        "url_id": body.url_id,
        "url_creator": video_info.get("uploader") or video_info.get("channel"),
        "url_title": video_info.get("title"),
        "url_channel_icon": channel_icon_url,
        "duration": duration,
        "is_too_long": duration is not None and duration > max_song_length_seconds,
        "file_loc": None,
        "is_downloaded": False,
    }
    priority_num = playlist_store.find_priority_for_name(playlist_entry["name_id"]) + 1
    playlist_store.add_song(playlist_entry, priority_num)
    return playlist_entry

@router.get("/")
async def get_playlist() -> list[PlaylistEntry]:
    return playlist_store.songs

@router.get("/now-playing")
async def now_playing() -> PlaylistEntry | None:
    return playlist_store.current_song

@router.get("/queue-finished")
async def queue_finished() -> bool:
    # True once playback has run past the last song; now-playing then still names that song.
    return playlist_store.finished

@router.get("/current-play", dependencies=[Depends(require_admin)])
async def playing_song():
    return playlist_store.playback_state()

@router.get("/playback-source", dependencies=[Depends(require_admin)])
async def playback_source() -> dict[str, str | None]:
    current_song = playlist_store.current_song
    if current_song is None:
        return {"url": None}
    playback_url = await asyncio.to_thread(extract_playback_url, current_song.url)
    if playback_url is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No playable video stream was found",
        )
    return {"url": playback_url}

@router.get("/playback-stream", dependencies=[Depends(require_admin)])
async def playback_stream(start: float = 0):
    current_song = playlist_store.current_song
    if current_song is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No song is currently selected",
        )
    video_url, audio_url = await get_playback_formats(current_song.url)

    # Look up the next song while this one plays, so it starts without the yt-dlp wait.
    next_song = playlist_store.find_next_song()
    if next_song is not None:
        prefetch_task = asyncio.create_task(prefetch_playback_formats(next_song.url))
        prefetch_tasks.add(prefetch_task)
        prefetch_task.add_done_callback(prefetch_tasks.discard)

    # "start" (seconds) begins the stream partway through, for when the player jumps ahead.
    # The video then starts at the keyframe before that point; -copyts and delay_moov keep the
    # real start times (as MP4 edit lists) so the player can place it on the timeline.
    seek = ["-copyts", "-ss", str(start)] if start > 0 else []
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", *seek, "-i", video_url]
    if audio_url:
        command.extend([*seek[1:], "-i", audio_url, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac"])
    else:
        command.extend(["-c", "copy"])
    movflags = "frag_keyframe+empty_moov" + ("+delay_moov" if start > 0 else "")
    command.extend(["-f", "mp4", "-movflags", movflags, "pipe:1"])

    async def stream():
        # stderr is discarded: nothing reads it, and a full pipe would stall ffmpeg.
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            if process.stdout is None:
                raise RuntimeError("FFmpeg stdout is not available")
            while chunk := await process.stdout.read(1024 * 1024):
                yield chunk
        finally:
            if process.returncode is None:
                process.terminate()
            await process.wait()

    return StreamingResponse(stream(), media_type="video/mp4")

@router.post("/play_pause", dependencies=[Depends(require_admin)])
async def play_pause() -> bool:
    return playlist_store.play_pause()

@router.post("/skip", dependencies=[Depends(require_admin)])
async def skip():
    playlist_store.skip()
    return playlist_store.playback_state()

@router.post("/back", dependencies=[Depends(require_admin)])
async def back():
    playlist_store.back()
    return playlist_store.playback_state()

@router.post("/jump", dependencies=[Depends(require_admin)])
async def jump(body: PlaylistJump):
    if not (0 <= body.order_num < len(playlist_store.songs)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playlist entry not found",
        )
    playlist_store.jump(body.order_num)
    return playlist_store.playback_state()

@router.delete("/flush", dependencies=[Depends(require_admin)])
async def flush_playlist() -> dict[str, str]:
    playlist_store.flush()
    return {"message": "Playlist flushed"}

@router.delete("/delete", dependencies=[Depends(require_admin)])
async def delete(playlist_id: int) -> PlaylistEntry:
    song = playlist_store.delete_song(playlist_id)
    if song is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playlist entry not found",
        )
    return song

@router.post("/keep", dependencies=[Depends(require_admin)])
async def keep(playlist_id: int) -> PlaylistEntry:
    song = playlist_store.keep_long_song(playlist_id)
    if song is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playlist entry not found",
        )
    return song

@router.post("/swap", dependencies=[Depends(require_admin)])
async def swap(body: PlaylistSwap) -> list[PlaylistEntry]:
    if body.original == body.swap:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The songs must have different order numbers",
        )

    if not playlist_store.swap_songs(body.original, body.swap):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or both playlist entries were not found",
        )
    return [playlist_store.songs[body.swap], playlist_store.songs[body.original]]

@router.post("/move", dependencies=[Depends(require_admin)])
async def move(body: PlaylistMove) -> PlaylistEntry:
    if body.order_num < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="order_num must be non-negative",
        )
    song = playlist_store.move_song(body.p_id, body.order_num)
    if song is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playlist entry not found",
        )
    return song
