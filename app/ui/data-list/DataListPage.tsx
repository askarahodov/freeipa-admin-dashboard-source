import type { ReactNode } from "react";
import { PageHeader } from "../PageHeader";
import styles from "./data-list.module.css";

export interface DataListPageProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function DataListPage({ title, description, actions, toolbar, children, footer, className }: DataListPageProps) {
  const classes = [styles.page, className].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <PageHeader title={title} description={description} actions={actions} />
      {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
      <div className={styles.body}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </section>
  );
}
