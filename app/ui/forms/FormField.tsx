import { cloneElement, type ReactElement } from "react";
import { resolveFieldRequirement } from "./form-field-state";
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
  const requirement = resolveFieldRequirement(required, children.props.required === true, optional);
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], helpId, errorId].filter(Boolean).join(" ") || undefined;
  const control = cloneElement(children, {
    id,
    required: requirement.required,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : children.props["aria-invalid"],
  });
  const classes = ["ds-field", error ? "ds-field--invalid" : "", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <label className={styles.fieldLabel} htmlFor={id}>
        <span>{label}</span>
        {requirement.required ? <span className={styles.required}>Обязательно</span> : requirement.optional ? <span className={styles.optional}>Необязательно</span> : null}
      </label>
      {control}
      {helpText ? <p className="ds-field-helper" id={helpId}>{helpText}</p> : null}
      {error ? <p className="ds-field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}
