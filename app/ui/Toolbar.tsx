import type { HTMLAttributes } from "react";
import styles from "./ui.module.css";

export type ToolbarProps = HTMLAttributes<HTMLDivElement>;

export function Toolbar({ className, ...props }: ToolbarProps) {
  const classes = [styles.toolbar, className].filter(Boolean).join(" ");
  return <div className={classes} {...props} />;
}
