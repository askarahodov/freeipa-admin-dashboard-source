import type { HTMLAttributes } from "react";
import styles from "./ui.module.css";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

const toneClass: Record<StatusTone, string> = {
  neutral: styles.statusNeutral,
  success: styles.statusSuccess,
  warning: styles.statusWarning,
  danger: styles.statusDanger,
  info: styles.statusInfo,
  primary: styles.statusPrimary,
};

export function StatusBadge({ tone = "neutral", className, ...props }: StatusBadgeProps) {
  const classes = [styles.status, toneClass[tone], className].filter(Boolean).join(" ");
  return <span className={classes} data-tone={tone} {...props} />;
}
