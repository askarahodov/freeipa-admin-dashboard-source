import type { ReactNode } from "react";
import styles from "./forms.module.css";

export interface DialogFooterProps {
  danger?: ReactNode;
  actions: ReactNode;
  className?: string;
}

export function DialogFooter({ danger, actions, className }: DialogFooterProps) {
  const classes = [styles.dialogFooter, className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <div className={styles.dialogDanger}>{danger}</div>
      <div className={styles.dialogActions}>{actions}</div>
    </div>
  );
}
