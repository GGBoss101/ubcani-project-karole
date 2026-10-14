"use client";

import { useEffect, useState } from "react";
import { BACKEND_URI } from "../../../lib/config";
import { adminFetch } from "../../../lib/admin-auth";
import { getErrorMessage } from "../../../lib/api-error";
import AdminHeader from "../../../components/admin-header";
import shared from "../admin.module.css";
import styles from "./page.module.css";

export default function AdminNames() {
    const [names, setNames] = useState([]);
    const [newName, setNewName] = useState("");
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("loading");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [draggedName, setDraggedName] = useState("");
    const [draggedIsPrimary, setDraggedIsPrimary] = useState(false);

    // Names matching the search (the main name or any alternate), alphabetical.
    const query = search.trim().toLowerCase();
    const shownNames = names
        .filter((entry) => !query || [entry.name, ...entry.name_alt].some((name) => name.toLowerCase().includes(query)))
        .sort((first, second) => first.name.localeCompare(second.name));

    async function loadNames() {
        try {
            const response = await adminFetch(`${BACKEND_URI}/names/`, { cache: "no-store" });
            if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
            setNames(await response.json());
            setStatus("ready");
        } catch (requestError) {
            setError(requestError.message);
            setStatus("error");
        }
    }

    useEffect(() => {
        Promise.resolve().then(loadNames);
    }, []);

    async function request(url, options = {}) {
        setError("");
        setMessage("");
        try {
            const response = await adminFetch(`${BACKEND_URI}${url}`, options);
            const result = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(getErrorMessage(result, response));
            }
            await loadNames();
            return result;
        } catch (requestError) {
            setError(requestError.message);
            return null;
        }
    }

    async function addName(event) {
        event.preventDefault();
        const name = newName.trim();
        if (!name) return;

        const result = await request("/names/add?create_pending_operation=false", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        if (result) {
            setNewName("");
            setMessage(result.found ? "That name already exists." : "Name added.");
        }
    }

    async function flushNames() {
        if (!window.confirm("WARNING: this permanently deletes every managed name.")) return;
        await request("/names/flush", { method: "DELETE" });
    }

    function startDrag(name, isPrimary) {
        setDraggedName(name);
        setDraggedIsPrimary(isPrimary);
    }

    function endDrag() {
        setDraggedName("");
        setDraggedIsPrimary(false);
    }

    // Touch screens can't drag, so tapping a name selects it instead, and the bar at the
    // bottom of the screen offers the same actions as the drop zones.
    function toggleSelect(event, name, isPrimary) {
        event.stopPropagation();
        if (draggedName === name) {
            endDrag();
        } else {
            startDrag(name, isPrimary);
        }
    }

    function tapRow(targetName) {
        if (!draggedIsPrimary || draggedName === targetName) return;
        if (!window.confirm(`Make "${draggedName}" an alternate of "${targetName}"?`)) return;
        convertToAlternative(targetName);
    }

    function confirmDelete() {
        if (!window.confirm(`Delete "${draggedName}"?`)) return;
        dropAction("delete");
    }

    const selectedEntry = names.find((entry) => entry.name === draggedName);

    async function convertToAlternative(targetName) {
        if (!draggedName || !draggedIsPrimary || draggedName === targetName) return;
        await request("/names/to_alt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: targetName, name_alt: draggedName }),
        });
        endDrag();
    }

    async function dropAction(action) {
        if (!draggedName) return;
        if (action === "to-name" && !draggedIsPrimary) {
            await request("/names/to_name", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: draggedName }),
            });
        }
        if (action === "blacklist") {
            await request("/names/blacklist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: draggedName }),
            });
        }
        if (action === "unblacklist") {
            await request("/names/unblacklist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: draggedName }),
            });
        }
        if (action === "delete") {
            await request("/names/delete", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: draggedName }),
            });
        }
        endDrag();
    }

    function allowDrop(event) {
        event.preventDefault();
    }

    return (
        <main className={shared.page}>
            <AdminHeader />
            <section className={shared.panel}>
                <div className={shared.heading}>
                    <div>
                        <p className={shared.eyebrow}>Admin / Names</p>
                        <h1>Manage names</h1>
                    </div>
                </div>

                <form className={styles.addForm} onSubmit={addName}>
                    <label htmlFor="new-name">Add a name</label>
                    <input
                        id="new-name"
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                        placeholder="Enter a name"
                        maxLength={30}
                        required
                    />
                    <button className={shared.button} type="submit">Add name</button>
                </form>

                {error && <p className={shared.error} role="alert">{error}</p>}
                {message && <p className={shared.success} role="status">{message}</p>}
                {status === "loading" && <p className={shared.message}>Loading names...</p>}
                {status === "ready" && names.length > 0 && (
                    <label className={styles.search}>
                        <span>Search names</span>
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Name or alternate name"
                        />
                    </label>
                )}
                {status === "ready" && names.length === 0 && <p className={shared.message}>No managed names.</p>}
                {status === "ready" && names.length > 0 && shownNames.length === 0 && (
                    <p className={shared.message}>No names match &quot;{search.trim()}&quot;.</p>
                )}
                {status === "ready" && shownNames.length > 0 && (
                    <div className={shared.tableWrap}>
                        <table>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Name</th>
                                    <th>Alternate names</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shownNames.map((entry) => (
                                        <tr
                                            key={entry.name_id}
                                            className={draggedIsPrimary && draggedName !== entry.name ? styles.target : ""}
                                            onDragOver={allowDrop}
                                            onDrop={() => convertToAlternative(entry.name)}
                                            onClick={() => tapRow(entry.name)}
                                        >
                                            <td data-label="ID">{entry.name_id}</td>
                                            <td className={shared.name} data-label="Name">
                                                <button
                                                    type="button"
                                                    className={`${styles.draggableName} ${draggedName === entry.name ? styles.selected : ""}`}
                                                    aria-pressed={draggedName === entry.name}
                                                    draggable
                                                    onClick={(event) => toggleSelect(event, entry.name, true)}
                                                    onDragStart={() => startDrag(entry.name, true)}
                                                    onDragEnd={endDrag}
                                                >
                                                    {entry.name}
                                                </button>
                                            </td>
                                            <td className={styles.alternates} data-label="Alternates">
                                                {entry.name_alt.length > 0 ? entry.name_alt.map((alternate) => (
                                                    <button
                                                        type="button"
                                                        className={`${styles.draggableName} ${draggedName === alternate ? styles.selected : ""}`}
                                                        aria-pressed={draggedName === alternate}
                                                        draggable
                                                        key={alternate}
                                                        onClick={(event) => toggleSelect(event, alternate, false)}
                                                        onDragStart={() => startDrag(alternate, false)}
                                                        onDragEnd={endDrag}
                                                    >
                                                        {alternate}
                                                    </button>
                                                )) : "-"}
                                            </td>
                                            <td data-label="Status">
                                                <span className={entry.blacklist ? styles.blacklisted : styles.active}>
                                                    {entry.blacklist ? "Blacklisted" : "Active"}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <p className={styles.hint}>Drag a name onto an action, or tap a name to choose what to do with it.</p>
                <div className={styles.dropZones}>
                    <div className={styles.dropZone} onDragOver={allowDrop} onDrop={() => dropAction("to-name")}>
                        <strong>Alternative to name</strong>
                        <span>Drop an alternate name here to promote it.</span>
                    </div>
                    <div className={styles.dropZone} onDragOver={allowDrop} onDrop={() => dropAction("blacklist")}>
                        <strong>Blacklist</strong>
                        <span>Drop a primary name here.</span>
                    </div>
                    <div className={styles.dropZone} onDragOver={allowDrop} onDrop={() => dropAction("unblacklist")}>
                        <strong>Unblacklist</strong>
                        <span>Drop a blacklisted name here.</span>
                    </div>
                    <div className={`${styles.dropZone} ${styles.deleteZone}`} onDragOver={allowDrop} onDrop={() => dropAction("delete")}>
                        <strong>Delete</strong>
                        <span>Drop any name here to remove it.</span>
                    </div>
                </div>

                {draggedName && (
                    <div className={styles.selectionBar} role="region" aria-label="Selected name">
                        <p>
                            <strong>{draggedName}</strong>
                            {draggedIsPrimary && " · tap another name's row to make it an alternate of that name"}
                        </p>
                        <div className={styles.selectionActions}>
                            {!draggedIsPrimary && (
                                <button type="button" onClick={() => dropAction("to-name")}>Make primary</button>
                            )}
                            {draggedIsPrimary && !selectedEntry?.blacklist && (
                                <button type="button" onClick={() => dropAction("blacklist")}>Blacklist</button>
                            )}
                            {draggedIsPrimary && selectedEntry?.blacklist && (
                                <button type="button" onClick={() => dropAction("unblacklist")}>Unblacklist</button>
                            )}
                            <button type="button" className={styles.deleteAction} onClick={confirmDelete}>Delete</button>
                            <button type="button" onClick={endDrag}>Cancel</button>
                        </div>
                    </div>
                )}

                <div className={shared.dangerZone}>
                    <p>Destructive actions</p>
                    <button className={shared.flushButton} onClick={flushNames}>Flush names database</button>
                </div>
            </section>
        </main>
    );
}