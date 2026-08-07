import type { TableHTMLAttributes } from "react";
import styles from "./data-list.module.css";

export interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  label: string;
}

export function DataTable({ label, className, ...props }: DataTableProps) {
  const classes = [styles.table, className].filter(Boolean).join(" ");

  return (
    <div className={styles.tableRegion} role="region" aria-label={label} tabIndex={0}>
      <table className={classes} {...props} />
    </div>
  );
}
