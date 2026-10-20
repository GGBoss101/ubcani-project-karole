"use client";

import Image from "next/image";
import Link from "next/link";
import mei from "../../../assets/Mei_NEW_cropped.png";
import Header from "../../components/header";
import QueueItem from "../../components/queue-item";
import { usePlaylist } from "../../lib/use-playlist";
import { describeLength, totalLength } from "../../lib/queue-time";
import styles from "./page.module.css";

export default function Playlist() {
    const { songs, upcoming, currentId, status, error } = usePlaylist();
    const playedCount = songs.length - upcoming.length;

    return (
        <main className={styles.page}>
            <Header />
            <section className={styles.panel}>
                <div className={styles.heading}>
                    <div>
                        <p className={styles.eyebrow}>
                            <span className={styles.liveDot} aria-hidden="true" />
                            Live queue
                        </p>
                        <h1>The playlist</h1>
                    </div>
                    {status === "ready" && upcoming.length > 0 && (
                        <p className={styles.count}>
                            {upcoming.length} {upcoming.length === 1 ? "song" : "songs"} to go ·{" "}
                            {describeLength(totalLength(upcoming))}
                        </p>
                    )}
                </div>

                {status === "loading" && <p className={styles.message}>Loading playlist...</p>}
                {status === "error" && <p className={styles.error}>{error}</p>}
                {status === "ready" && songs.length === 0 && (
                    <div className={styles.empty}>
                        <Image className={styles.emptyArt} src={mei} alt="Mei, the UBCAni mascot, waving" sizes="260px" />
                        <p>No songs in the playlist yet.</p>
                        <Link className={`button-primary ${styles.cta}`} href="/add">Add the first song</Link>
                    </div>
                )}
                {status === "ready" && songs.length > 0 && (
                    <ol className={styles.queue}>
                        {songs.map((song, index) => (
                            <QueueItem
                                key={song.p_id}
                                song={song}
                                position={index + 1}
                                nowPlaying={song.p_id === currentId}
                                played={index < playedCount}
                                wideNumber={songs.length >= 100}
                            />
                        ))}
                    </ol>
                )}
            </section>
        </main>
    );
}
