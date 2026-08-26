import type { HTMLAttributes } from "react";
import styles from "./ui.module.css";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  badge?: boolean;
}

const toneClass: Record<StatusTone, string> = {
  neutral: styles.statusNeutral,
  success: styles.statusSuccess,
  warning: styles.statusWarning,
  danger: styles.statusDanger,
  info: styles.statusInfo,
  primary: styles.statusPrimary,
};

const dsBadgeTone: Record<StatusTone, string> = {
  neutral: "ds-badge-neutral",
  success: "ds-badge-success",
  warning: "ds-badge-warning",
  danger: "ds-badge-danger",
  info: "ds-badge-primary",
  primary: "ds-badge-primary",
};

export function StatusBadge({ tone = "neutral", badge = false, className, ...props }: StatusBadgeProps) {
  const classes = [
    badge ? "ds-badge" : styles.status,
    badge ? dsBadgeTone[tone] : toneClass[tone],
    className,
  ].filter(Boolean).join(" ");
  return <span className={classes} data-tone={tone} {...props} />;
}
