# Owns the playlist while the server runs: the songs in play order, which song is
# playing, and the append-only JSON log of every change. Nothing is read back at
# startup; the last line of the log is enough to recreate the object by hand.
import json
import os
import time

from models import NameEntry, PlaylistEntry

# How long a person's later songs wait at the back of the queue, in seconds: the 2nd song
# 10 minutes, each one after that 5 more, never more than 30 minutes.
SECOND_SONG_DELAY = 10 * 60
EXTRA_SONG_DELAY = 5 * 60
MAX_SONG_DELAY = 30 * 60


def line_up_time(priority: int, added_time: float) -> float:
    # priority is which of the person's songs this is tonight: 1 for their first, 2 for the
    # second, and so on.
    if priority <= 1:
        return added_time
    delay = SECOND_SONG_DELAY + EXTRA_SONG_DELAY * (priority - 2)
    return added_time + min(delay, MAX_SONG_DELAY)


# One JSON object per line, appended after every change.
PLAYLIST_LOG_PATH = os.path.join(os.path.dirname(__file__), "playlist_log.jsonl")


class Playlist:
    def __init__(self, log_path: str):
        self.log_path = log_path
        self.songs: list[PlaylistEntry] = []
        self.current_song: PlaylistEntry | None = None
        self.playing = False
        # True once playback has run past the last song. current_song then stays on that
        # last song, so everything up to it counts as sung and new songs play next.
        self.finished = False

    def renumber_and_log(self) -> None:
        # order_num always mirrors the position in the list, so it never has gaps or duplicates.
        for index, song in enumerate(self.songs):
            song.order_num = index

        current_song_p_id = None
        if self.current_song is not None:
            current_song_p_id = self.current_song.p_id
        log_entry = {
            "time": time.time(),
            "playing": self.playing,
            "current_song_p_id": current_song_p_id,
            "songs": [song.model_dump() for song in self.songs],
        }
        with open(self.log_path, "a", encoding="utf-8") as log_file:
            log_file.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

    def find_index(self, p_id: int) -> int | None:
        for index, song in enumerate(self.songs):
            if song.p_id == p_id:
                return index
        return None

    def find_current_index(self) -> int | None:
        for index, song in enumerate(self.songs):
            if song is self.current_song:
                return index
        return None

    def find_next_song(self) -> PlaylistEntry | None:
        current_index = self.find_current_index()
        if current_index is None or current_index + 1 >= len(self.songs):
            return None
        return self.songs[current_index + 1]

    def find_song_by_url(self, service: str | None, url_id: str | None) -> PlaylistEntry | None:
        for song in self.songs:
            if song.service == service and song.url_id == url_id:
                return song
        return None

    def next_p_id(self) -> int:
        highest_p_id = -1
        for song in self.songs:
            if song.p_id > highest_p_id:
                highest_p_id = song.p_id
        return highest_p_id + 1

    def find_priority_for_name(self, name_id: int) -> int:
        # A person's songs are numbered 1, 2, 3... so everyone gets a first turn
        # before anyone gets a second one. Returns 0 when they have no songs yet.
        highest_priority = 0
        for song in self.songs:
            if song.name_id == name_id and song.priority_num > highest_priority:
                highest_priority = song.priority_num
        return highest_priority

    def find_insert_index(self, priority: int, added_time: float) -> int:
        # Songs line up by when they were added plus a delay that grows with how many songs
        # that person already has queued (see line_up_time). A person's 2nd song is held at
        # the back for 10 minutes, letting everyone who adds a song meanwhile go ahead; after
        # that its place is fixed. New songs never go before the song playing now (or the
        # last one sung), and songs the admin moved by hand keep their places.
        new_line_up = line_up_time(priority, added_time)
        current_index = self.find_current_index()
        start = current_index + 1 if current_index is not None else 0
        for index in range(start, len(self.songs)):
            song = self.songs[index]
            if line_up_time(song.priority_num, song.time) > new_line_up:
                return index
        return len(self.songs)

    def add_song(self, song_info: dict, priority: int) -> PlaylistEntry:
        insert_index = self.find_insert_index(priority, song_info["time"])
        song = PlaylistEntry(
            **song_info,
            p_id=self.next_p_id(),
            order_num=insert_index,
            priority_num=priority,
        )
        self.songs.insert(insert_index, song)
        self.renumber_and_log()
        return song

    def delete_song(self, p_id: int) -> PlaylistEntry | None:
        index = self.find_index(p_id)
        if index is None:
            return None
        song = self.songs.pop(index)
        if song is self.current_song:
            # The playing song was removed, so playback continues with the song that took its place.
            self.select_song(index)
        self.renumber_and_log()
        return song

    def keep_long_song(self, p_id: int) -> PlaylistEntry | None:
        # The admin chose to let a too-long song play, so stop flagging it.
        index = self.find_index(p_id)
        if index is None:
            return None
        song = self.songs[index]
        song.is_too_long = False
        self.renumber_and_log()
        return song

    def move_song(self, p_id: int, new_index: int) -> PlaylistEntry | None:
        index = self.find_index(p_id)
        if index is None:
            return None
        song = self.songs.pop(index)
        self.songs.insert(new_index, song)
        self.renumber_and_log()
        return song

    def swap_songs(self, first_index: int, second_index: int) -> bool:
        song_count = len(self.songs)
        if not (0 <= first_index < song_count and 0 <= second_index < song_count):
            return False
        first_song = self.songs[first_index]
        self.songs[first_index] = self.songs[second_index]
        self.songs[second_index] = first_song
        self.renumber_and_log()
        return True

    def flush(self) -> None:
        self.songs = []
        self.current_song = None
        self.playing = False
        self.finished = False
        self.renumber_and_log()

    def requeue_songs_under_name(self, old_name_id: int, name_entry: NameEntry) -> None:
        # Punish mode: when a name is merged into another, its songs lose their places
        # and are queued again, oldest first, as new songs of the name they now belong to.
        # Songs already sung (and the one playing now) only change name: moving the playing
        # song would make skip jump over everything in between, and moving a sung one back
        # into the queue would play it again.
        current_index = self.find_current_index()
        sung = set()
        songs_to_requeue = []
        for index, song in enumerate(self.songs):
            if song.name_id == old_name_id:
                songs_to_requeue.append(song)
                if current_index is not None and index <= current_index:
                    sung.add(song.p_id)
        songs_to_requeue.sort(key=lambda song: song.time)

        for song in songs_to_requeue:
            song.name_id = name_entry.name_id
            song.name = name_entry.name
            if song.p_id in sung:
                continue
            self.songs.pop(self.find_index(song.p_id))
            song.priority_num = self.find_priority_for_name(name_entry.name_id) + 1
            self.songs.insert(self.find_insert_index(song.priority_num, song.time), song)
        self.renumber_and_log()

    def playback_state(self) -> dict:
        return {"playing": self.playing, "song": self.current_song}

    def select_song(self, index: int) -> None:
        # Plays the song at this position. Past the end it stops on the last song (see
        # finished); before the start it stops with nothing selected.
        self.finished = False
        if 0 <= index < len(self.songs):
            self.current_song = self.songs[index]
            self.playing = True
        elif self.songs and index >= len(self.songs):
            self.current_song = self.songs[-1]
            self.playing = False
            self.finished = True
        else:
            self.current_song = None
            self.playing = False

    def play_pause(self) -> bool:
        current_index = self.find_current_index()
        if self.finished and current_index is not None:
            # Play starts the first song added since the queue ran out, or plays the last
            # song again when nothing new has been added.
            next_index = current_index + 1
            self.select_song(next_index if next_index < len(self.songs) else current_index)
            self.renumber_and_log()
            return self.playing
        if self.current_song is None:
            if not self.songs:
                return False
            self.current_song = self.songs[0]
        self.playing = not self.playing
        self.renumber_and_log()
        return self.playing

    def skip(self) -> None:
        current_index = self.find_current_index()
        if current_index is None:
            self.select_song(0)
        else:
            self.select_song(current_index + 1)
        self.renumber_and_log()

    def back(self) -> None:
        current_index = self.find_current_index()
        if current_index is None:
            self.select_song(len(self.songs) - 1)
        elif self.finished:
            # After the queue ran out, back replays the last song.
            self.select_song(current_index)
        else:
            self.select_song(current_index - 1)
        self.renumber_and_log()

    def jump(self, index: int) -> None:
        self.select_song(index)
        self.renumber_and_log()


playlist_store = Playlist(PLAYLIST_LOG_PATH)
