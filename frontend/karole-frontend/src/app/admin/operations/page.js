"use client";

import { useEffect, useRef, useState } from "react";
import { BACKEND_URI } from "../../../lib/config";
import { adminFetch } from "../../../lib/admin-auth";
import AdminHeader from "../../../components/admin-header";
import shared from "../admin.module.css";
import styles from "./page.module.css";
import { getErrorMessage, statusMessage } from "../../../lib/api-error";
import { loadCombineQueues, saveCombineQueues } from "../../../lib/merge-queues";

// Names change on the Names page and singers' songs bring new suggestions, so the list
// refreshes itself this often while the page is in view, and whenever the admin comes back to it.
const REFRESH_MS = 5000;

export default function AdminOperations() {
    const [operations, setOperations] = useState([]);
    const [status, setStatus] = useState("loading");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [combineQueues, setCombineQueues] = useState(true);
    // Counts list requests, so an older answer that arrives after a newer one is ignored.
    const latestLoad = useRef(0);

    async function loadOperations() {
        const load = ++latestLoad.current;
        try {
            const response = await adminFetch(`${BACKEND_URI}/operation/`, { cache: "no-store" });
            if (!response.ok) throw new Error(statusMessage(response.status));
            const result = await response.json();
            if (load !== latestLoad.current) return;
            setOperations(result);
            setStatus("ready");
        } catch (requestError) {
            if (load !== latestLoad.current) return;
            setError(requestError.message);
            // A failed refresh keeps showing the list already loaded.
            setStatus((current) => (current === "ready" ? current : "error"));
        }
    }

    useEffect(() => {
        Promise.resolve().then(loadOperations);
        Promise.resolve().then(() => setCombineQueues(loadCombineQueues()));

        function refreshIfVisible() {
            if (document.visibilityState === "visible") loadOperations();
        }
        const timer = window.setInterval(refreshIfVisible, REFRESH_MS);
        window.addEventListener("focus", refreshIfVisible);
        document.addEventListener("visibilitychange", refreshIfVisible);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", refreshIfVisible);
            document.removeEventListener("visibilitychange", refreshIfVisible);
        };
    }, []);

    function changeCombineQueues(combine) {
        setCombineQueues(combine);
        saveCombineQueues(combine);
    }

    async function runOperation(url, operationId, confirmation) {
        if (confirmation && !window.confirm(confirmation)) return;
        setError("");
        setMessage("");
        try {
            // Matching merges two names, so it follows the combine queues checkbox.
            const query = url.includes("handle") ? `?combine_queues=${combineQueues}` : "";
            const response = await adminFetch(`${BACKEND_URI}${url}${query}`, {
                method: url.includes("delete") ? "DELETE" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ po_id: operationId }),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(getErrorMessage(result, response));
            }
            await loadOperations();
            setMessage(url.includes("handle") ? "Operation matched." : "Operation ignored.");
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function flushOperations() {
        if (!window.confirm("WARNING: this permanently ignores every pending operation.")) return;
        setError("");
        try {
            const response = await adminFetch(`${BACKEND_URI}/operation/flush`, { method: "DELETE" });
            if (!response.ok) throw new Error(statusMessage(response.status));
            await loadOperations();
            setMessage("All pending operations ignored.");
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function matchAll() {
        if (!window.confirm("Match every pending operation?")) return;
        setError("");
        setMessage("");
        try {
            const response = await adminFetch(`${BACKEND_URI}/operation/handle_all?combine_queues=${combineQueues}`, {
                method: "POST",
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(getErrorMessage(result, response));
            }
            await loadOperations();
            setMessage(`Matched ${result.length} pending operation${result.length === 1 ? "" : "s"}.`);
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return (
        <main className={shared.page}>
            <AdminHeader />
            <section className={shared.panel}>
                <div className={shared.heading}>
                    <div>
                        <p className={shared.eyebrow}>Admin / Operations</p>
                        <h1>Pending operations</h1>
                    </div>
                    <div className={styles.headingActions}>
                        <button className="button-primary" onClick={matchAll}>Match all</button>
                        <button className={shared.flushButton} onClick={flushOperations}>Ignore all</button>
                    </div>
                </div>

                {error && <p className={shared.error} role="alert">{error}</p>}
                {message && <p className={shared.success} role="status">{message}</p>}
                <label className={styles.combineQueues}>
                    <input
                        type="checkbox"
                        checked={combineQueues}
                        onChange={(event) => changeCombineQueues(event.target.checked)}
                    />
                    <span>
                        <strong>Combine queues when merging names</strong>
                        {combineQueues
                            ? "Both names' songs count as one person's turns. Their waiting songs line up again with the usual 10–30 minute delay, counted from when each song was added. Songs already sung stay where they are."
                            : "The merged name's songs keep their places and only change name."}
                    </span>
                </label>

                {status === "loading" && <p className={shared.message}>Loading pending operations...</p>}
                {status === "ready" && operations.length === 0 && (
                    <p className={shared.message}>No pending operations.</p>
                )}
                {status === "ready" && operations.length > 0 && (
                    <div className={shared.tableWrap}>
                        <table>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Primary name</th>
                                    <th>Alternative name</th>
                                    <th>Similarity</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {operations
                                    .slice()
                                    .sort((first, second) => second.score - first.score)
                                    .map((operation) => (
                                        <tr key={operation.po_id}>
                                            <td data-label="ID">{operation.po_id}</td>
                                            <td className={shared.name} data-label="Primary">{operation.name}</td>
                                            <td data-label="Alternative">{operation.name_alt}</td>
                                            <td data-label="Similarity">
                                                <span className={styles.score}>{operation.score.toFixed(1)}%</span>
                                            </td>
                                            <td>
                                                <div className={styles.actions}>
                                                <button onClick={() => runOperation(
                                                    "/operation/handle",
                                                    operation.po_id,
                                                    `Match "${operation.name_alt}" as an alternate of "${operation.name}"?`
                                                )}>Match</button>
                                                <button className={styles.delete} onClick={() => runOperation(
                                                    "/operation/delete",
                                                    operation.po_id,
                                                    `Ignore this pending operation for "${operation.name_alt}"?`
                                                )}>Ignore</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                )}

            </section>
        </main>
    );
}