"use client";

import { useState } from "react";
import { thumbnailUrl } from "../lib/youtube";

// A song's YouTube thumbnail. The striped placeholder shows until it loads, or instead of it
// if YouTube has none.
export default function SongThumbnail({ song, className = "" }) {
    const src = thumbnailUrl(song);
    const [failed, setFailed] = useState(false);
    return (
        <span className={`image-placeholder ${className}`} aria-hidden="true">
            {src && !failed && (
                // eslint-disable-next-line @next/next/no-img-element -- plain img: thumbnails come straight from YouTube
                <img
                    src={src}
                    alt=""
                    loading="lazy"
                    onError={() => setFailed(true)}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
            )}
        </span>
    );
}
