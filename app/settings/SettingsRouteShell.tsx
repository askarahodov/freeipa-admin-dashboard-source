"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { settingsSections } from "./settings-navigation";
import styles from "./settings-route-shell.module.css";

const implementedSections = new Set(["general", "integrations", "presentation", "visibility"]);

export function SettingsRouteShell({
  title,
  description,
  children,
  hasUnsavedChanges = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  hasUnsavedChanges?: boolean;
}) {
  const pathname = usePathname();

  function guardNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!hasUnsavedChanges) return;
    if (!window.confirm("Есть несохранённые изменения. Выйти без сохранения?")) event.preventDefault();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Настройки портала</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>

      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="Разделы настроек">
          {settingsSections.map((section) => {
            const active = pathname === section.path;
            if (implementedSections.has(section.id)) {
              return <Link key={section.id} href={section.path} onClick={guardNavigation} aria-current={active ? "page" : undefined} className={active ? styles.active : undefined}>{section.label}</Link>;
            }
            return <span key={section.id} aria-disabled="true" className={styles.pending}>{section.label}<small>миграция</small></span>;
          })}
        </nav>
        <section className={styles.content}>{children}</section>
      </div>
    </main>
  );
}
