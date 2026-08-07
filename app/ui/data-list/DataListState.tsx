import type { ReactNode } from "react";
import { Alert } from "../Alert";
import styles from "./data-list.module.css";

export type DataListStateKind = "loading" | "empty" | "filtered-empty" | "error" | "forbidden";

export interface DataListStateProps {
  kind: DataListStateKind;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function DataListState({ kind, title, description, action }: DataListStateProps) {
  const tone = kind === "error" ? "danger" : kind === "forbidden" ? "warning" : "neutral";
  const role = kind === "error" ? "alert" : "status";
  return <Alert tone={tone} role={role} className={styles.state}><div className={styles.stateCopy}><strong>{title}</strong>{description ? <span>{description}</span> : null}</div>{action ? <div className={styles.stateAction}>{action}</div> : null}</Alert>;
}
