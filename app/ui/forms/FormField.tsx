import { cloneElement, type ReactElement } from "react";
import styles from "./forms.module.css";

type FieldControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
};

export interface FormFieldProps {
  id: string;
  label: string;
  children: ReactElement<FieldControlProps>;
  helpText?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
}

export function FormField({ id, label, children, helpText, error, required = false, optional = false, className }: FormFieldProps) {
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], helpId, errorId].filter(Boolean).join(" ") || undefined;
  const control = cloneElement(children, {
    id,
    required: required || children.props.required,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : children.props["aria-invalid"],
  });
  const classes = [styles.field, error ? styles.fieldInvalid : "", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <label className={styles.fieldLabel} htmlFor={id}>
        <span>{label}</span>
        {required ? <span className={styles.required}>Обязательно</span> : optional ? <span className={styles.optional}>Необязательно</span> : null}
      </label>
      {control}
      {helpText ? <p className={styles.helpText} id={helpId}>{helpText}</p> : null}
      {error ? <p className={styles.errorText} id={errorId}>{error}</p> : null}
    </div>
  );
}
