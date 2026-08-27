import type { HTMLAttributes } from "react";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number;
  label?: string;
}

export function Spinner({ size = 18, label = "Загрузка…", className, style, ...props }: SpinnerProps) {
  const classes = ["ds-spinner", className].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      style={{ width: size, height: size, ...style }}
      role="status"
      aria-label={label}
      {...props}
    />
  );
}
