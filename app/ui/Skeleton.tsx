import type { HTMLAttributes } from "react";

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "text" | "circle" | "rect";
  width?: number | string;
  height?: number | string;
}

export function Skeleton({ variant = "text", width, height, className, style, ...props }: SkeletonProps) {
  const variantClass =
    variant === "circle" ? "ds-skeleton-circle" : variant === "text" ? "ds-skeleton-text" : "";
  const classes = ["ds-skeleton", variantClass, className].filter(Boolean).join(" ");
  const resolvedHeight = height ?? (variant === "text" ? 14 : undefined);
  return (
    <span
      className={classes}
      style={{ width, height: resolvedHeight, ...style }}
      aria-hidden="true"
      {...props}
    />
  );
}
