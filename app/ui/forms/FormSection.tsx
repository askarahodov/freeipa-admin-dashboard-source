import type { HTMLAttributes, ReactNode } from "react";
import styles from "./forms.module.css";

export interface FormSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
}

export function FormSection({ title, description, children, className, ...props }: FormSectionProps) {
  const classes = [styles.section, className].filter(Boolean).join(" ");
  return (
    <section className={classes} {...props}>
      <div className={styles.sectionHeading}>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
