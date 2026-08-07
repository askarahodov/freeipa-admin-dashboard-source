import { Button } from "../Button";
import styles from "./data-list.module.css";

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems?: number;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

export function Pagination({ page, totalPages, totalItems, onPrevious, onNext, disabled = false }: PaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);
  const previousDisabled = disabled || page <= 1;
  const nextDisabled = disabled || page >= totalPages || totalPages <= 1;

  return (
    <nav className={styles.pagination} aria-label="Пагинация">
      <div className={styles.paginationSummary} aria-live="polite">
        <strong>Страница {safePage} из {safeTotalPages}</strong>
        {typeof totalItems === "number" ? <span>{totalItems.toLocaleString("ru-RU")} записей</span> : null}
      </div>
      <div className={styles.paginationActions}>
        <Button variant="secondary" disabled={previousDisabled} onClick={onPrevious}>Назад</Button>
        <Button variant="secondary" disabled={nextDisabled} onClick={onNext}>Далее</Button>
      </div>
    </nav>
  );
}
