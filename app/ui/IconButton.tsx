import type { ButtonHTMLAttributes } from "react";
import styles from "./ui.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  "aria-label": string;
}

export function IconButton({ className, type, ...props }: IconButtonProps) {
  const classes = [styles.iconButton, className].filter(Boolean).join(" ");
  return <button className={classes} type={type ?? "button"} {...props} />;
}
