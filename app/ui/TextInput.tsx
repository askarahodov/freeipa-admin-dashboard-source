import type { InputHTMLAttributes } from "react";
import styles from "./ui.module.css";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, ...props }: TextInputProps) {
  const classes = [styles.input, "ds-input", className].filter(Boolean).join(" ");
  return <input className={classes} {...props} />;
}
