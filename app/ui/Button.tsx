import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "icon" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "lg";
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "ds-btn-primary",
  secondary: "ds-btn-secondary",
  danger: "ds-btn-danger",
  ghost: "ds-btn-ghost",
  icon: "ds-btn-icon",
  sm: "ds-btn-sm",
};

export function Button({ variant = "secondary", size, className, type, ...props }: ButtonProps) {
  const classes = ["ds-btn", variantClass[variant], size ? `ds-btn-${size}` : "", className].filter(Boolean).join(" ");
  return <button className={classes} type={type ?? "button"} {...props} />;
}
