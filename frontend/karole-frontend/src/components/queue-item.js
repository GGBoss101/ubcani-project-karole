import SongThumbnail from "./song-thumbnail";
import styles from "./queue-item.module.css";

// One song in the live queue. "compact" drops the singer for small previews,
// "nowPlaying" spotlights the song being sung, and "played" fades out songs already sung.
// "wideNumber" makes room for a three-digit position; a list sets it on all its cards at once.
export default function QueueItem({ song, position, compact = false, nowPlaying = false, played = false, wideNumber = false }) {
    const classNames = [
        styles.item,
        compact && styles.compact,
        nowPlaying && styles.nowPlaying,
        played && styles.played,
        wideNumber && styles.wideNumber,
    ];
    return (
        <li className={classNames.filter(Boolean).join(" ")}>
            <span className={styles.position}>{String(position).padStart(2, "0")}</span>
            <SongThumbnail song={song} className={styles.thumb} />
            <div className={styles.details}>
                <div className={styles.titleRow}>
                    {nowPlaying && (
                        <span className={styles.badge}>
                            Now<span className={styles.badgeMore}> singing</span>
                        </span>
                    )}
                    <a className={styles.title} href={song.url} target="_blank" rel="noreferrer" title={song.youtube_title}>
                        {song.youtube_title}
                    </a>
                </div>
                {/* The song name and singer each get their own line, and a line is kept even when
                    it's empty, so every card in the list has the same shape. */}
                <p className={styles.meta}>
                    <span className={styles.songName} title={song.song_name || undefined}>{song.song_name || "\u00a0"}</span>
                    {!compact && <span title={song.name}>{song.name}</span>}
                </p>
            </div>
        </li>
    );
}
