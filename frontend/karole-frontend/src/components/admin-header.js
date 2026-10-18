"use client";

import Image from "next/image";
import Link from "next/link";
import logo from "../../assets/Onigiri_Blue.svg";
import { usePathname } from "next/navigation";
import { logOut } from "../lib/admin-auth";
import styles from "./admin-header.module.css";

export default function AdminHeader() {
    const pathname = usePathname();

    return (
        <header className={styles.header}>
            <Link className={styles.brand} href="/admin/playlist">
                <Image className={styles.logo} src={logo} alt="" width={34} height={34} priority />
                <span>UBCANI</span>
                <span className={styles.badge}>Admin</span>
            </Link>
            <nav className={styles.nav} aria-label="Admin navigation">
                <Link className={pathname === "/admin/playlist" ? styles.active : ""} href="/admin/playlist">
                    Playlist
                </Link>
                <Link className={pathname === "/admin/names" ? styles.active : ""} href="/admin/names">
                    Names
                </Link>
                <Link className={pathname === "/admin/operations" ? styles.active : ""} href="/admin/operations">
                    Operations
                </Link>
                <Link href="/admin/view" target="_blank" rel="noreferrer">
                    View
                </Link>
                <button className={styles.logout} type="button" onClick={logOut}>
                    Log out
                </button>
            </nav>
        </header>
    );
}