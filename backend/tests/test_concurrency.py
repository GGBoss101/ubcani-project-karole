# Several people pressing the controls at the same moment, say from their phones: fires bursts of
# simultaneous requests at the playlist routes and checks the queue ends up in one sensible state.
#
# Runs entirely in this process against a fresh, empty playlist with its log in a temporary file,
# so the server's live queue, playlist_log.jsonl and MongoDB are never touched: MongoDB clients are
# replaced before anything imports them (any call that slips through fails loudly), the queue
# settings, names, blocked songs and the YouTube lookup are stubbed, and the admin login is skipped.
#
# Run from the backend folder:  .venv/bin/python tests/test_concurrency.py
import asyncio
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class NoMongo:
    # Stands in for every MongoDB client, collection and call; awaiting it raises.
    def __init__(self, *args, **kwargs):
        pass

    def __getitem__(self, key):
        return self

    def __getattr__(self, key):
        return self

    def __call__(self, *args, **kwargs):
        return self


import pymongo  # noqa: E402

pymongo.MongoClient = NoMongo
pymongo.AsyncMongoClient = NoMongo

import httpx  # noqa: E402

import main  # noqa: E402
from auth import require_admin  # noqa: E402
from models import NameEntry  # noqa: E402
from name import name as name_module  # noqa: E402
from playlist import playlist as routes  # noqa: E402
from playlist.playlist_store import Playlist  # noqa: E402

LOG_DIR = tempfile.mkdtemp(prefix="karole-test-")
SETTINGS = {"open": True, "pause_before_songs": False, "auto_play": False, "auto_play_seconds": 10}


async def fake_settings():
    await asyncio.sleep(0.01)  # a real MongoDB read yields too, letting other requests in
    return dict(SETTINGS)


class NoBlockedSongs:
    async def find_one(self, *args, **kwargs):
        await asyncio.sleep(0.01)
        return None


async def fake_read_name(body, *args, **kwargs):
    await asyncio.sleep(0.01)
    return {"entry": NameEntry(name_id=500, name=body.name, name_alt=[], blacklist=False)}


def fake_video_info(url):
    time.sleep(0.2)  # the YouTube lookup is slow, which is when two adds overlap
    return {"title": "Test video", "duration": 200, "uploader": "Test channel"}


routes.read_queue_settings = fake_settings
routes.blocked_col = NoBlockedSongs()
routes.extract_video_info = fake_video_info
routes.extract_channel_icon_url = lambda url: None
name_module.read_name = fake_read_name
main.app.dependency_overrides[require_admin] = lambda: {"admin": True}


def fresh_queue(song_count: int = 6, current: int | None = 0, playing: bool = True) -> Playlist:
    store = Playlist(os.path.join(LOG_DIR, f"log-{time.time_ns()}.jsonl"))
    for number in range(song_count):
        store.add_song(
            {
                "name_id": number,
                "time": 1000 + number,
                "name": f"Singer {number}",
                "song_name": f"Song {number}",
                "service": "youtube",
                "url": f"https://www.youtube.com/watch?v=video{number:06d}",
                "url_id": f"video{number:06d}",
                "url_creator": "Test channel",
                "youtube_title": f"Video {number}",
                "url_channel_icon": None,
                "duration": 200,
                "is_too_long": False,
                "file_loc": None,
                "is_downloaded": False,
            },
            1,
        )
    if current is not None:
        store.jump(current)
        store.playing = playing
    routes.playlist_store = store
    return store


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def each_song_once(store: Playlist, expected: int) -> None:
    ids = [song.p_id for song in store.songs]
    check(len(ids) == expected and len(set(ids)) == expected, f"all {expected} songs are there, each once")
    check([song.order_num for song in store.songs] == list(range(len(ids))), "places are numbered 0, 1, 2... with no gaps")


async def burst(client: httpx.AsyncClient, requests: list[tuple[str, str, dict]]) -> list[httpx.Response]:
    return await asyncio.gather(*(client.request(method, url, **options) for method, url, options in requests))


async def main_test() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        print("10 people press Play at once (song paused)")
        store = fresh_queue(playing=False)
        answers = await burst(client, [("POST", "/playlist/play", {})] * 10)
        check(all(answer.status_code == 200 for answer in answers), "every press answered 200")
        check(store.playing is True, "still playing afterwards, not toggled back off")

        print("10 people press Pause at once")
        await burst(client, [("POST", "/playlist/pause", {})] * 10)
        check(store.playing is False, "paused afterwards")

        print("Play and Pause pressed together, 10 times each")
        store = fresh_queue(playing=False)
        requests = [("POST", "/playlist/play", {}), ("POST", "/playlist/pause", {})] * 10
        answers = await burst(client, requests)
        check(all(answer.status_code == 200 for answer in answers), "every press answered 200")
        check(store.current_song is not None and store.current_song.p_id == 0, "still on the same song")

        print("10 people press Skip on song 0 at once")
        store = fresh_queue()
        answers = await burst(client, [("POST", "/playlist/skip?from_p_id=0", {})] * 10)
        check(all(answer.status_code == 200 for answer in answers), "every press answered 200")
        check(store.current_song.p_id == 1, "moved on one song (to song 1), not ten")
        each_song_once(store, 6)

        print("For comparison, 3 Skips without from_p_id still each skip (older callers)")
        store = fresh_queue()
        await burst(client, [("POST", "/playlist/skip", {})] * 3)
        check(store.current_song.p_id == 3, "three plain skips move three songs")

        print("Back and Skip pressed together on song 2, 5 times each")
        store = fresh_queue(current=2)
        requests = [("POST", "/playlist/back?from_p_id=2", {}), ("POST", "/playlist/skip?from_p_id=2", {})] * 5
        await burst(client, requests)
        check(store.current_song.p_id in (1, 3), f"moved exactly one song either way (now song {store.current_song.p_id})")
        each_song_once(store, 6)

        print("Skip pressed on a song after someone already skipped it is ignored")
        store = fresh_queue(current=3)
        answer = await client.post("/playlist/skip?from_p_id=2")
        check(answer.status_code == 200 and answer.json()["song"]["p_id"] == 3, "nothing changed; the current song comes back")

        print("Jump to song 4 by p_id while someone deletes song 1 (which moves song 4 up a place)")
        store = fresh_queue()
        answers = await burst(client, [
            ("DELETE", "/playlist/delete?playlist_id=1", {}),
            ("POST", "/playlist/jump", {"json": {"p_id": 4}}),
        ])
        check([answer.status_code for answer in answers] == [200, 200], "both answered 200")
        check(store.current_song.p_id == 4, "landed on song 4, the song that was tapped")
        each_song_once(store, 5)

        print("Jump to a song that someone deletes at the same moment")
        store = fresh_queue()
        answers = await burst(client, [
            ("DELETE", "/playlist/delete?playlist_id=5", {}),
            ("POST", "/playlist/jump", {"json": {"p_id": 5}}),
        ])
        check(answers[1].status_code in (200, 404), f"the jump answered {answers[1].status_code}, no crash")
        check(store.current_song is not None and store.current_song.p_id != 5 or answers[1].status_code == 200,
              "never left on the deleted song")
        each_song_once(store, 5)

        print("Jump by place to the last song while someone deletes a song (older callers)")
        store = fresh_queue()
        answers = await burst(client, [
            ("DELETE", "/playlist/delete?playlist_id=0", {}),
            ("POST", "/playlist/jump", {"json": {"order_num": 5}}),
        ])
        check(answers[1].status_code in (200, 404), f"the jump answered {answers[1].status_code}, not a server error")

        print("Swap songs 2 and 3 by p_id while someone moves song 3 to the top")
        store = fresh_queue()
        answers = await burst(client, [
            ("POST", "/playlist/move", {"json": {"p_id": 3, "order_num": 0}}),
            ("POST", "/playlist/swap", {"json": {"p_id": 2, "swap_p_id": 3}}),
        ])
        check([answer.status_code for answer in answers] == [200, 200], "both answered 200")
        check({song["p_id"] for song in answers[1].json()} == {2, 3}, "the swap answered with songs 2 and 3")
        each_song_once(store, 6)

        print("Two people add the same video at the same moment")
        store = fresh_queue()
        body = {"url": "https://www.youtube.com/watch?v=dupVideo123", "name": "Alex", "song_name": "Same song"}
        answers = await burst(client, [("POST", "/playlist/add", {"json": body})] * 2)
        codes = sorted(answer.status_code for answer in answers)
        check(codes == [200, 400], f"one added, one turned away (answers {codes})")
        check(sum(song.url_id == "dupVideo123" for song in store.songs) == 1, "the video is in the queue once")
        each_song_once(store, 7)

        print("A mixed storm: 40 presses of every kind at once")
        store = fresh_queue(song_count=8)
        requests = []
        for round_number in range(5):
            requests += [
                ("POST", "/playlist/play", {}),
                ("POST", "/playlist/pause", {}),
                ("POST", "/playlist/skip?from_p_id=0", {}),
                ("POST", "/playlist/back?from_p_id=0", {}),
                ("POST", "/playlist/jump", {"json": {"p_id": 6}}),
                ("POST", "/playlist/swap", {"json": {"p_id": 1, "swap_p_id": 2}}),
                ("POST", "/playlist/move", {"json": {"p_id": 7, "order_num": round_number}}),
                ("DELETE", f"/playlist/delete?playlist_id={4 if round_number == 0 else 99}", {}),
            ]
        answers = await burst(client, requests)
        check(all(answer.status_code < 500 for answer in answers), "no server errors")
        each_song_once(store, 7)
        check(store.current_song is None or store.current_song in store.songs, "the current song is in the queue")

    print("\nAll checks passed. Temporary logs were written to", LOG_DIR)


if __name__ == "__main__":
    asyncio.run(main_test())
