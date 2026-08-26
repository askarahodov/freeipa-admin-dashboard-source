import type { SelectHTMLAttributes } from "react";
import styles from "./ui.module.css";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  const classes = [styles.select, "ds-select", className].filter(Boolean).join(" ");
  return <select className={classes} {...props} />;
}
