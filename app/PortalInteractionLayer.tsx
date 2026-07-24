"use client";

import { useEffect, useMemo, useState } from "react";

type FeedbackKind = "forbidden" | "timeout" | "conflict" | "rate-limit" | "unavailable" | "error";

type Feedback = {
  id: string;
  kind: FeedbackKind;
  title: string;
  message: string;
  status: number | null;
  retryAfter: string;
  method: string;
  path: string;
};

type Confirmation = {
  button: HTMLButtonElement;
  title: string;
  message: string;
  confirmLabel: string;
  tone: "warning" | "danger";
  requireReason: boolean;
  requireDeletePhrase: boolean;
};

type PortalFeedbackDetail = Omit<Feedback, "id">;

const feedbackEventName = "portal:request-error";
const requestStartEventName = "portal:request-start";
const requestEndEventName = "portal:request-end";
const ignoredAuthPaths = new Set(["/api/auth/session", "/api/auth/login", "/api/auth/logout"]);

function feedbackForStatus(status: number, fallback: string): Pick<Feedback, "kind" | "title" | "message"> {
  if (status === 403) return { kind: "forbidden", title: "Недостаточно прав", message: fallback || "Текущая роль не разрешает это действие." };
  if (status === 408 || status === 504) return { kind: "timeout", title: "Превышено время ожидания", message: fallback || "Сервис не ответил вовремя. Проверьте подключение и повторите операцию." };
  if (status === 409) return { kind: "conflict", title: "Конфликт состояния", message: fallback || "Данные изменились. Обновите страницу и повторите действие с актуальным состоянием." };
  if (status === 429) return { kind: "rate-limit", title: "Слишком много запросов", message: fallback || "Сервис временно ограничил запросы. Дождитесь указанного времени и повторите действие." };
  if (status >= 500) return { kind: "unavailable", title: "Сервис временно недоступен", message: fallback || "Внешний сервис или локальный gateway вернул ошибку." };
  return { kind: "error", title: "Операция не выполнена", message: fallback || `Сервер вернул HTTP ${status}.` };
}

function safePath(input: RequestInfo | URL): string {
  try {
    const value = input instanceof Request ? input.url : String(input);
    const url = new URL(value, window.location.origin);
    return url.pathname;
  } catch {
    return "/api";
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

async function responseMessage(response: Response): Promise<{ message: string; retryAfter: string }> {
  const retryAfterHeader = response.headers.get("retry-after") || "";
  try {
    const payload = await response.clone().json() as Record<string, unknown>;
    const message = String(payload.error || payload.message || "").slice(0, 500);
    const retryAfter = String(payload.retryAfter || retryAfterHeader || "").slice(0, 120);
    return { message, retryAfter };
  } catch {
    try {
      return { message: (await response.clone().text()).slice(0, 500), retryAfter: retryAfterHeader.slice(0, 120) };
    } catch {
      return { message: "", retryAfter: retryAfterHeader.slice(0, 120) };
    }
  }
}

function dispatchFeedback(detail: PortalFeedbackDetail) {
  window.dispatchEvent(new CustomEvent<PortalFeedbackDetail>(feedbackEventName, { detail }));
}

function installFetchObserver(): () => void {
  const state = window as typeof window & { __portalOriginalFetch?: typeof window.fetch; __portalFetchUsers?: number };
  state.__portalFetchUsers = (state.__portalFetchUsers || 0) + 1;
  if (state.__portalOriginalFetch) {
    return () => { state.__portalFetchUsers = Math.max(0, (state.__portalFetchUsers || 1) - 1); };
  }

  const originalFetch = window.fetch.bind(window);
  state.__portalOriginalFetch = originalFetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = requestMethod(input, init);
    const path = safePath(input);
    const observed = path.startsWith("/api/") && !ignoredAuthPaths.has(path);
    if (observed) window.dispatchEvent(new Event(requestStartEventName));
    try {
      const response = await originalFetch(input, init);
      if (observed && response.status >= 403) {
        const details = await responseMessage(response);
        const classified = feedbackForStatus(response.status, details.message);
        dispatchFeedback({ ...classified, status: response.status, retryAfter: details.retryAfter, method, path });
      }
      return response;
    } catch (cause) {
      if (observed) {
        const timeout = cause instanceof DOMException && cause.name === "AbortError";
        dispatchFeedback({
          kind: timeout ? "timeout" : "unavailable",
          title: timeout ? "Превышено время ожидания" : "Нет соединения с сервисом",
          message: timeout ? "Запрос был остановлен по таймауту." : "Проверьте сеть, DNS, TLS и доступность локального gateway.",
          status: null,
          retryAfter: "",
          method,
          path,
        });
      }
      throw cause;
    } finally {
      if (observed) window.dispatchEvent(new Event(requestEndEventName));
    }
  };

  return () => {
    state.__portalFetchUsers = Math.max(0, (state.__portalFetchUsers || 1) - 1);
    if (state.__portalFetchUsers === 0 && state.__portalOriginalFetch) {
      window.fetch = state.__portalOriginalFetch;
      delete state.__portalOriginalFetch;
    }
  };
}

function normalizedText(button: HTMLButtonElement): string {
  return (button.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function confirmationFor(button: HTMLButtonElement): Omit<Confirmation, "button"> | null {
  const text = normalizedText(button);
  const context = (button.closest(".modal, .approval-card, .run-details-modal, .access-user-card")?.textContent || "").replace(/\s+/g, " ").trim();
  if (text.includes("остановить задание")) return { title: "Остановить активное задание?", message: "XYOps получит команду остановки. Уже выполненные шаги могут не откатиться автоматически.", confirmLabel: "Остановить задание", tone: "danger", requireReason: false, requireDeletePhrase: false };
  if (text === "повторить" || text.includes("запустить снова")) return { title: "Повторить выполнение?", message: "Будет создан новый XYOps Job с ранее проверенными несекретными параметрами.", confirmLabel: "Создать новый запуск", tone: "warning", requireReason: false, requireDeletePhrase: false };
  if (text === "одобрить") return { title: "Одобрить опасную операцию?", message: "Ваше решение будет записано в append-only аудит. После достижения порога инициатор сможет выполнить операцию.", confirmLabel: "Одобрить", tone: "warning", requireReason: false, requireDeletePhrase: false };
  if (text === "отклонить") return { title: "Отклонить заявку?", message: "Укажите причину. Она будет доступна инициатору и сохранена в аудите.", confirmLabel: "Отклонить заявку", tone: "danger", requireReason: true, requireDeletePhrase: false };
  if (text.includes("отменить заявку")) return { title: "Отменить заявку?", message: "Текущая заявка больше не сможет быть согласована или выполнена.", confirmLabel: "Отменить заявку", tone: "danger", requireReason: false, requireDeletePhrase: false };
  if (text.includes("выполнить в xyops")) return { title: "Выполнить согласованную операцию?", message: "После подтверждения портал отправит команду в XYOps. Секретные поля, если они есть, будут запрошены следующим шагом.", confirmLabel: "Выполнить в XYOps", tone: "warning", requireReason: false, requireDeletePhrase: false };
  if (text === "отключить" || text.includes("отключить пользователя")) return { title: "Отключить пользователя?", message: "Пользователь потеряет возможность входа или выполнения операций до повторного включения.", confirmLabel: "Отключить", tone: "danger", requireReason: false, requireDeletePhrase: false };
  const deleting = text.includes("удалить") || (/удалить (пользователя|группу)/i.test(context) && (button.type === "submit" || button.classList.contains("primary")));
  if (deleting) return { title: "Безвозвратно удалить объект?", message: `${context.slice(0, 220) || "Выбранный объект будет удалён."} Для защиты от случайного действия введите слово УДАЛИТЬ.`, confirmLabel: "Удалить безвозвратно", tone: "danger", requireReason: false, requireDeletePhrase: true };
  return null;
}

function replayConfirmedClick(confirmation: Confirmation, reason: string) {
  const button = confirmation.button;
  if (!button.isConnected || button.disabled) return;
  button.dataset.portalConfirmed = "1";
  const originalConfirm = window.confirm;
  const originalPrompt = window.prompt;
  window.confirm = () => true;
  if (confirmation.requireReason) window.prompt = () => reason;
  try {
    button.click();
  } finally {
    queueMicrotask(() => {
      window.confirm = originalConfirm;
      window.prompt = originalPrompt;
    });
  }
}

export default function PortalInteractionLayer() {
  const [pending, setPending] = useState(0);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reason, setReason] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");

  useEffect(() => installFetchObserver(), []);

  useEffect(() => {
    const start = () => setPending((value) => value + 1);
    const end = () => setPending((value) => Math.max(0, value - 1));
    const fail = (event: Event) => {
      const detail = (event as CustomEvent<PortalFeedbackDetail>).detail;
      setFeedback((items) => [{ ...detail, id: crypto.randomUUID() }, ...items].slice(0, 3));
    };
    window.addEventListener(requestStartEventName, start);
    window.addEventListener(requestEndEventName, end);
    window.addEventListener(feedbackEventName, fail);
    return () => {
      window.removeEventListener(requestStartEventName, start);
      window.removeEventListener(requestEndEventName, end);
      window.removeEventListener(feedbackEventName, fail);
    };
  }, []);

  useEffect(() => {
    const capture = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest("button") as HTMLButtonElement | null;
      if (!button || button.disabled || button.dataset.portalConfirmationControl === "1") return;
      if (button.dataset.portalConfirmed === "1") {
        delete button.dataset.portalConfirmed;
        return;
      }
      const intent = confirmationFor(button);
      if (!intent) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setReason("");
      setDeletePhrase("");
      setConfirmation({ button, ...intent });
    };
    document.addEventListener("click", capture, true);
    return () => document.removeEventListener("click", capture, true);
  }, []);

  const canConfirm = useMemo(() => {
    if (!confirmation) return false;
    if (confirmation.requireReason && reason.trim().length < 3) return false;
    if (confirmation.requireDeletePhrase && deletePhrase.trim().toUpperCase() !== "УДАЛИТЬ") return false;
    return true;
  }, [confirmation, deletePhrase, reason]);

  function confirmAction() {
    if (!confirmation || !canConfirm) return;
    const current = confirmation;
    setConfirmation(null);
    replayConfirmedClick(current, reason.trim());
  }

  return <>
    <div className={`portal-request-progress ${pending > 0 ? "active" : ""}`} aria-hidden="true"><span /></div>
    <aside className="portal-feedback-stack" aria-live="polite">
      {feedback.map((item) => <article className={`portal-feedback-card ${item.kind}`} key={item.id}>
        <div className="portal-feedback-icon">{item.kind === "forbidden" ? "⊘" : item.kind === "conflict" ? "↻" : item.kind === "rate-limit" ? "◷" : item.kind === "timeout" ? "⌛" : "!"}</div>
        <div><strong>{item.title}</strong><p>{item.message}</p><small>{item.status ? `HTTP ${item.status} · ` : ""}{item.method} {item.path}{item.retryAfter ? ` · повтор после ${item.retryAfter}` : ""}</small></div>
        <div className="portal-feedback-actions">{["GET", "HEAD"].includes(item.method) && <button data-portal-confirmation-control="1" onClick={() => window.location.reload()}>Обновить</button>}<button data-portal-confirmation-control="1" aria-label="Закрыть сообщение" onClick={() => setFeedback((items) => items.filter((entry) => entry.id !== item.id))}>×</button></div>
      </article>)}
    </aside>
    {confirmation && <div className="portal-confirm-backdrop" role="presentation" onMouseDown={() => setConfirmation(null)}>
      <section className={`portal-confirm-dialog ${confirmation.tone}`} role="alertdialog" aria-modal="true" aria-labelledby="portal-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="portal-confirm-symbol">{confirmation.tone === "danger" ? "!" : "◇"}</div>
        <div><span className="eyebrow">ПРОВЕРКА ДЕЙСТВИЯ</span><h2 id="portal-confirm-title">{confirmation.title}</h2><p>{confirmation.message}</p></div>
        {confirmation.requireReason && <label>Причина отклонения<textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Опишите причину для инициатора и аудита" /><small>Минимум 3 символа</small></label>}
        {confirmation.requireDeletePhrase && <label>Контрольная фраза<input autoFocus value={deletePhrase} onChange={(event) => setDeletePhrase(event.target.value)} placeholder="УДАЛИТЬ" autoComplete="off" /><small>Введите УДАЛИТЬ заглавными или строчными буквами</small></label>}
        <div className="portal-confirm-actions"><button className="secondary" data-portal-confirmation-control="1" onClick={() => setConfirmation(null)}>Отмена</button><button className={confirmation.tone === "danger" ? "danger-button" : "primary"} data-portal-confirmation-control="1" disabled={!canConfirm} onClick={confirmAction}>{confirmation.confirmLabel}</button></div>
      </section>
    </div>}
  </>;
}
