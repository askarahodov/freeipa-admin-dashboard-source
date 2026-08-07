import styles from "./forms.module.css";

export interface FormErrorItem {
  message: string;
  fieldId?: string;
}

export interface FormErrorSummaryProps {
  title?: string;
  errors: FormErrorItem[];
}

export function FormErrorSummary({ title = "Проверьте форму", errors }: FormErrorSummaryProps) {
  if (!errors.length) return null;
  return (
    <div className={styles.errorSummary} role="alert">
      <strong>{title}</strong>
      <ul>
        {errors.map((item, index) => (
          <li key={`${item.fieldId ?? "form"}-${index}`}>
            {item.fieldId ? <a href={`#${item.fieldId}`}>{item.message}</a> : item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
