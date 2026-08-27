"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { IconCheck, IconWarning, IconClose, IconBell } from "../icons";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, "onAction" | "actionLabel">> {
  id: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <IconCheck size={18} />,
  error: <IconClose size={18} />,
  warning: <IconWarning size={18} />,
  info: <IconBell size={18} />,
};

const toneClass: Record<ToastTone, string> = {
  success: "ds-toast-success",
  error: "ds-toast-error",
  warning: "ds-toast-warning",
  info: "ds-toast-info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      const id = Date.now() + Math.random();
      const item: ToastItem = {
        id,
        message: options.message,
        tone: options.tone ?? "info",
        duration: options.duration ?? 3200,
        actionLabel: options.actionLabel,
        onAction: options.onAction,
      };
      setItems((prev) => [...prev, item]);
      window.setTimeout(() => dismiss(id), item.duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ds-toast-viewport" role="region" aria-live="polite" aria-label="Уведомления">
        {items.map((item) => (
          <div key={item.id} className={`ds-toast ${toneClass[item.tone]}`}>
            <span className="icon">{toneIcon[item.tone]}</span>
            <span className="ds-toast-message">{item.message}</span>
            {item.actionLabel ? (
              <button
                type="button"
                className="ds-toast-action"
                onClick={() => {
                  item.onAction?.();
                  dismiss(item.id);
                }}
              >
                {item.actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="ds-toast-close"
              aria-label="Закрыть"
              onClick={() => dismiss(item.id)}
            >
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
