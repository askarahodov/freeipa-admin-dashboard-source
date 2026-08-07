import type { ButtonHTMLAttributes } from "react";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  danger: styles.danger,
  ghost: styles.ghost,
};

export function Button({ variant = "secondary", className, type, ...props }: ButtonProps) {
  const classes = [styles.button, variantClass[variant], className].filter(Boolean).join(" ");
  return <button className={classes} type={type ?? "button"} {...props} />;
}
