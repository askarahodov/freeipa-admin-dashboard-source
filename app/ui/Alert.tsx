import type { HTMLAttributes } from "react";
import styles from "./ui.module.css";
import type { StatusTone } from "./StatusBadge";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: StatusTone;
}

const toneClass: Record<StatusTone, string> = {
  neutral: styles.alertNeutral,
  success: styles.alertSuccess,
  warning: styles.alertWarning,
  danger: styles.alertDanger,
  info: styles.alertInfo,
  primary: styles.alertPrimary,
};

export function Alert({ tone = "neutral", className, role = "status", ...props }: AlertProps) {
  const classes = [styles.alert, toneClass[tone], className].filter(Boolean).join(" ");
  return <div className={classes} data-tone={tone} role={role} {...props} />;
}
