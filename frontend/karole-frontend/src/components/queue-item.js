import SongThumbnail from "./song-thumbnail";
import styles from "./queue-item.module.css";

// One song in the live queue. "compact" drops the channel and song name for small previews,
// "nowPlaying" spotlights the song being sung, and "played" fades out songs already sung.
export default function QueueItem({ song, position, compact = false, nowPlaying = false, played = false }) {
    const classNames = [styles.item, compact && styles.compact, nowPlaying && styles.nowPlaying, played && styles.played];
    return (
        <li className={classNames.filter(Boolean).join(" ")}>
            <span className={styles.position}>{String(position).padStart(2, "0")}</span>
            <SongThumbnail song={song} className={styles.thumb} />
            <div className={styles.details}>
                {nowPlaying && <span className={styles.badge}>Now singing</span>}
                <a className={styles.title} href={song.url} target="_blank" rel="noreferrer">
                    {song.youtube_title}
                </a>
                <p className={styles.meta}>
                    <span className={styles.singer}>{song.name}</span>
                    {!compact && song.song_name && <span>{song.song_name}</span>}
                    {!compact && song.url_creator && <span>{song.url_creator}</span>}
                </p>
            </div>
        </li>
    );
}
