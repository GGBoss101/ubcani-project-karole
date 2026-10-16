"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { BACKEND_URI } from "../../../lib/config";
import logo from "../../../../assets/favicon.png";
import styles from "./page.module.css";

// There is only one admin account, so the page asks for the password alone and sends this
// username with it. It must match ADMIN_USERNAME in backend/.env.
const ADMIN_USERNAME = "admin";

export default function AdminLogin() {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    async function handleSubmit(event) {
        event.preventDefault();
        if (!password) {
            setError("Enter the password to continue.");
            return;
        }

        setError("");
        try {
            const response = await fetch(`${BACKEND_URI}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ username: ADMIN_USERNAME, password }),
                // Lets the browser store the login cookie the backend sends back.
                credentials: "include",
            });
            const result = await response.json().catch(() => null);
            if (response.status === 401) throw new Error("That password isn't right.");
            if (!response.ok) throw new Error(result?.detail || "Unable to sign in");
            router.replace("/admin/playlist");
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return (
        <main className={styles.page}>
            <section className={styles.panel}>
                <Image className={styles.logo} src={logo} alt="" width={56} height={56} priority />
                <p className={styles.eyebrow}>UBCANI Karole admin</p>
                <h1>Sign in</h1>
                <p className={styles.intro}>Sign in to run the karaoke queue.</p>
                <form className={styles.form} onSubmit={handleSubmit}>
                    <label className={styles.field}>
                        <span>Password</span>
                        <input
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            autoFocus
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            required
                        />
                    </label>
                    <button className={`button-primary ${styles.submit}`} type="submit">Continue</button>
                    {error && <p className={styles.error} role="alert">{error}</p>}
                </form>
            </section>
        </main>
    );
}