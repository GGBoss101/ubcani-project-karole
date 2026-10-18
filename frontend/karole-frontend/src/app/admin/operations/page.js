"use client";

import { useEffect, useState } from "react";
import { BACKEND_URI } from "../../../lib/config";
import { adminFetch } from "../../../lib/admin-auth";
import AdminHeader from "../../../components/admin-header";
import shared from "../admin.module.css";
import styles from "./page.module.css";
import { getErrorMessage, statusMessage } from "../../../lib/api-error";
import { loadCombineQueues } from "../../../lib/merge-queues";

export default function AdminOperations() {
    const [operations, setOperations] = useState([]);
    const [status, setStatus] = useState("loading");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    async function loadOperations() {
        try {
            const response = await adminFetch(`${BACKEND_URI}/operation/`, { cache: "no-store" });
            if (!response.ok) throw new Error(statusMessage(response.status));
            setOperations(await response.json());
            setStatus("ready");
        } catch (requestError) {
            setError(requestError.message);
            setStatus("error");
        }
    }

    useEffect(() => {
        Promise.resolve().then(loadOperations);
    }, []);

    async function runOperation(url, operationId, confirmation) {
        if (confirmation && !window.confirm(confirmation)) return;
        setError("");
        setMessage("");
        try {
            // Matching merges two names, so it follows the Names page's combine queues setting.
            const query = url.includes("handle") ? `?combine_queues=${loadCombineQueues()}` : "";
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
            const response = await adminFetch(`${BACKEND_URI}/operation/handle_all?combine_queues=${loadCombineQueues()}`, {
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