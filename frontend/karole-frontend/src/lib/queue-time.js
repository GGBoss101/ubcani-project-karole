// Adds up song lengths for the "total queue time" shown to singers and admins.

// Seconds as "1:02:05" or "4:07".
export function formatLength(totalSeconds) {
    const seconds = Math.round(totalSeconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(seconds % 60).padStart(2, "0");
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

// Seconds as "about 1 h 5 min" or "about 23 min", for quick reading.
export function describeLength(totalSeconds) {
    const minutes = Math.round(totalSeconds / 60);
    if (minutes < 1) return "under a minute";
    if (minutes < 60) return `about ${minutes} min`;
    const rest = minutes % 60;
    return `about ${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}

// Some songs (live streams) have no known length; they are counted as zero.
export function totalLength(songs) {
    return songs.reduce((sum, song) => sum + (song.duration || 0), 0);
}
