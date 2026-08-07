import type { ReactNode } from "react";
import { ProductIcon } from "./ProductIcon";
import {
  PRODUCT_NAV_GROUPS,
  isProductNavItemActive,
  type ProductNavItem,
  type ProductNavItemId,
} from "./navigation";
import styles from "./app-shell.module.css";

export interface AppShellProps {
  currentPath: string;
  visibleItemIds: readonly ProductNavItemId[];
  badges?: Partial<Record<ProductNavItemId, string | number>>;
  onNavigate: (item: ProductNavItem) => void;
  brand: ReactNode;
  systemStatus?: ReactNode;
  header: ReactNode;
  children: ReactNode;
}

export function AppShell({
  currentPath,
  visibleItemIds,
  badges = {},
  onNavigate,
  brand,
  systemStatus,
  header,
  children,
}: AppShellProps) {
  const visible = new Set<ProductNavItemId>(visibleItemIds);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>{brand}</div>
        <nav className={styles.navigation} aria-label="Основная навигация">
          {PRODUCT_NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => visible.has(item.id));
            if (!items.length) return null;

            return (
              <section className={styles.group} key={group.id} aria-label={group.label || undefined}>
                {group.label ? <div className={styles.groupLabel}>{group.label}</div> : null}
                <div className={styles.groupItems}>
                  {items.map((item) => {
                    const active = isProductNavItemActive(item, currentPath);
                    const badge = badges[item.id];
                    return (
                      <button
                        className={`${styles.navItem} ${active ? styles.active : ""}`}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => onNavigate(item)}
                        key={item.id}
                      >
                        <ProductIcon name={item.icon} className={styles.navIcon} />
                        <span className={styles.navLabel}>{item.label}</span>
                        {badge !== undefined && badge !== null && badge !== "" ? (
                          <span className={styles.badge} aria-label={`${item.label}: ${badge}`}>{badge}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>
        {systemStatus ? <div className={styles.systemStatus}>{systemStatus}</div> : null}
      </aside>

      <div className={styles.workspace}>
        <header className={styles.header}>{header}</header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
