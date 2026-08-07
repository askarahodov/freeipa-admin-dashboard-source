import type { ReactNode } from "react";
import styles from "./ui.module.css";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, children, className }: PageHeaderProps) {
  const classes = [styles.pageHeader, className].filter(Boolean).join(" ");

  return (
    <header className={classes}>
      <div className={styles.pageHeaderCopy}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {description ? <p className={styles.pageDescription}>{description}</p> : null}
        {children}
      </div>
      {actions ? <div className={styles.pageHeaderActions}>{actions}</div> : null}
    </header>
  );
}
