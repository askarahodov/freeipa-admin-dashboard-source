"use client";

import { useEffect, useState } from "react";
import type { CatalogEvent, RouteField } from "../../automation-types";
import { fieldConditionMatches } from "../../field-conditions";
import type { FreeIpaAction, FreeIpaOperation } from "../../freeipa-ui-events";
import { resolveProcessIconGlyph } from "./home-presentation";
import { formatDateTime } from "../operations/OperationsApprovalsScreens";

export type PortalNotification = { id: string; runId: string; status: "success" | "failed" | "cancelled"; title: string; message: string; createdAt: number; readAt: number | null };

export function NotificationCenter({ items, unread, permission, close, markAll, enableSystem, openItem }: { items: PortalNotification[]; unread: number; permission: NotificationPermission | "unsupported"; close: () => void; markAll: () => void; enableSystem: () => void; openItem: (item: PortalNotification) => void }) {
  return <section className="notification-panel"><div className="notification-head"><div><strong>Уведомления</strong><small>{unread ? `${unread} непрочитанных` : "Новых уведомлений нет"}</small></div><button aria-label="Закрыть уведомления" onClick={close}>×</button></div><div className="notification-tools">{unread > 0 && <button onClick={markAll}>Прочитать все</button>}{permission === "default" && <button onClick={enableSystem}>Включить системные</button>}{permission === "denied" && <small>Системные уведомления запрещены браузером</small>}</div><div className="notification-list">{items.length ? items.map((item) => <button className={`notification-item ${item.status} ${item.readAt ? "read" : "unread"}`} key={item.id} onClick={() => openItem(item)}><i>{item.status === "success" ? "✓" : item.status === "cancelled" ? "■" : "!"}</i><span><strong>{item.title}</strong><p>{item.message}</p><small>{formatDateTime(item.createdAt)}</small></span>{!item.readAt && <b />}</button>) : <div className="notification-empty"><span>♢</span><strong>Уведомлений пока нет</strong><small>Завершения и ошибки заданий XYOps появятся здесь.</small></div>}</div></section>;
}




export function FreeIpaActionModal({ action, close, submit }: { action: FreeIpaAction; close: () => void; submit: (operation: FreeIpaOperation, data: Record<string, string>) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { operation, preset } = action;
  const isUserForm = operation === "user_add" || operation === "user_mod";
  const isGroupForm = operation === "group_add";
  const isMemberForm = operation === "group_add_member" || operation === "group_remove_member";
  const isPassword = operation === "user_password";
  const destructive = operation === "user_del" || operation === "group_del" || operation === "user_disable" || operation === "group_remove_member" || isPassword;
  return <div className="modal-backdrop"><form className="modal dynamic-modal" onSubmit={async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(Array.from(new FormData(event.currentTarget).entries()).map(([key, value]) => [key, String(value)]));
    if (isPassword && data.password !== data.passwordConfirm) { setError("Пароли не совпадают"); return; }
    setError(""); setBusy(true);
    if (!await submit(operation, data)) setBusy(false);
  }}><button type="button" className="modal-x" onClick={close}>×</button><span className="eyebrow">ПРЯМОЕ УПРАВЛЕНИЕ FREEIPA</span><h2>{action.title}</h2><p>Операция выполняется отдельным модулем FreeIPA. XYOps для неё не требуется.</p>
    {(isUserForm || isPassword || operation === "user_enable" || operation === "user_disable" || operation === "user_del") && <label>Логин<input name="username" required readOnly={operation !== "user_add"} defaultValue={preset.username ?? ""} pattern="[A-Za-z0-9_.@$-]+" autoFocus={operation !== "user_add" && !isPassword} /></label>}
    {isUserForm && <div className="two-cols"><label>Имя<input name="firstName" required={operation === "user_add"} defaultValue={preset.firstName ?? ""} autoFocus={operation === "user_add"} /></label><label>Фамилия<input name="lastName" required={operation === "user_add"} defaultValue={preset.lastName ?? ""} /></label></div>}
    {isUserForm && <label>Email<input name="email" type="email" defaultValue={preset.email ?? ""} /></label>}
    {operation === "user_add" && <label>Начальный пароль<input name="password" type="password" autoComplete="new-password" /><small>Необязательно. Пароль передаётся напрямую в FreeIPA и не сохраняется порталом.</small></label>}
    {isPassword && <><label>Новый временный пароль<input name="password" type="password" minLength={8} required autoComplete="new-password" autoFocus /></label><label>Повторите пароль<input name="passwordConfirm" type="password" minLength={8} required autoComplete="new-password" /></label></>}
    {(isGroupForm || isMemberForm || operation === "group_del") && <label>Группа{action.choices?.groups?.length ? <select name="group" required autoFocus defaultValue=""><option value="" disabled>Выберите группу</option>{action.choices.groups.map((group) => <option value={group} key={group}>{group}</option>)}</select> : <input name="group" required readOnly={!isGroupForm} defaultValue={preset.group ?? ""} pattern="[A-Za-z0-9_.@$-]+" autoFocus={isGroupForm} />}</label>}
    {isGroupForm && <label>Описание<input name="description" defaultValue={preset.description ?? ""} /></label>}
    {isMemberForm && <label>Логин участника{action.choices?.users?.length ? <select name="username" required autoFocus defaultValue=""><option value="" disabled>Выберите пользователя</option>{action.choices.users.map((uid) => <option value={uid} key={uid}>{uid}</option>)}</select> : <input name="username" required readOnly={Boolean(preset.username)} defaultValue={preset.username ?? ""} pattern="[A-Za-z0-9_.@$-]+" autoFocus={!preset.username} />}</label>}
    {error && <div className="settings-error"><strong>Ошибка</strong><span>{error}</span></div>}
    {destructive && <label className="checkbox-field danger-confirm"><input type="checkbox" required /><span><strong>Подтверждаю выполнение операции</strong><small>Изменение будет немедленно применено в FreeIPA</small></span></label>}
    <div className="schema-note"><span>▤</span><div><strong>Независимый модуль FreeIPA</strong><small>JSON-RPC через защищённый серверный Gateway</small></div></div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Отмена</button><button className="primary" disabled={busy} data-portal-confirmation-control={destructive ? "1" : undefined}>{busy ? "Выполнение…" : "Применить в FreeIPA"}</button></div>
  </form></div>;
}

export function ProcessModal({ event, preset = {}, close, submit }: { event: CatalogEvent; preset?: Record<string, string>; close: () => void; submit: (values: Record<string, unknown>, targets: string[]) => Promise<boolean> }) {
  const [submitting, setSubmitting] = useState(false);
  return <div className="modal-backdrop"><form className="modal process-modal" onSubmit={async (formEvent) => { formEvent.preventDefault(); setSubmitting(true); const form = new FormData(formEvent.currentTarget); const values: Record<string, unknown> = {}; for (const field of event.fields) { if (field.type === "boolean") values[field.key] = form.has(field.key); else if (field.type === "multiselect") values[field.key] = form.getAll(field.key).map(String); else values[field.key] = String(form.get(field.key) ?? ""); } const succeeded = await submit(values, form.getAll("__targets").map(String)); if (!succeeded) setSubmitting(false); }}><button type="button" className="modal-x" onClick={close}>×</button><div className="process-modal-head"><span className={`route-kind ${event.kind}`}>{resolveProcessIconGlyph(event.icon, event.kind)}</span><div><span className="eyebrow">{event.category} · {event.kind}</span><h2>{event.title}</h2><p>{event.description || "Параметры процесса загружены из XYOps."}</p></div></div><div className="schema-note"><span>◇</span><div><strong>Форма сгенерирована автоматически</strong><small>{event.fields.length} полей из схемы XYOps · ID: {event.id}{event.operation ? ` · ${event.operation}` : ""}</small></div></div>{event.targets.length > 0 && <label>Целевые системы{event.targets.length > 1 && <em>можно выбрать несколько</em>}<select name="__targets" multiple={event.targets.length > 1} required defaultValue={event.targets.length === 1 ? [event.targets[0]] : []}>{event.targets.map((target) => <option key={target} value={target}>{target}</option>)}</select><small>targets → run_event</small></label>}<GeneratedFields fields={event.fields} eventId={event.id} preset={preset} />{event.dangerous && <label className="checkbox-field danger-confirm"><input type="checkbox" required /><span><strong>Подтверждаю выполнение потенциально опасной операции</strong><small>XYOps получит команду только после подтверждения</small></span></label>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Отмена</button><button className="primary" disabled={submitting}>{submitting ? "Отправка…" : `Запустить ${event.kind === "workflow" ? "Workflow" : "Event"}`}</button></div></form></div>;
}

function conditionMatches(field: RouteField, values: Record<string, unknown>) {
  return fieldConditionMatches(field.visibleWhen, values);
}

function GeneratedFields({ fields, eventId, preset = {} }: { fields: RouteField[]; eventId: string; preset?: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((field) => [field.key, preset[field.key] ?? field.default ?? (field.type === "boolean" ? false : "")] )));
  const visibleFields = [...fields].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)).filter((field) => conditionMatches(field, values));
  const tree: FieldGroupNode = { title: "", fields: [], children: [] };
  for (const field of visibleFields) {
    const path = field.groupPath?.length ? field.groupPath : field.section ? [field.section] : [];
    let node = tree;
    for (const title of path) {
      let child = node.children.find((item) => item.title === title);
      if (!child) { child = { title, fields: [], children: [] }; node.children.push(child); }
      node = child;
    }
    node.fields.push(field);
  }
  return <div className="generated-form" onChangeCapture={(event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!target.name || target.name.startsWith("__")) return;
    const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target instanceof HTMLSelectElement && target.multiple ? Array.from(target.selectedOptions).map((option) => option.value) : target.value;
    setValues((current) => ({ ...current, [target.name]: value }));
  }}><FieldGroup group={tree} eventId={eventId} preset={preset} root /></div>;
}

type FieldGroupNode = { title: string; fields: RouteField[]; children: FieldGroupNode[] };

function FieldGroup({ group, eventId, preset, root = false }: { group: FieldGroupNode; eventId: string; preset: Record<string, string>; root?: boolean }) {
  const total = group.fields.length + group.children.reduce((sum, child) => sum + child.fields.length, 0);
  return <section className={root ? "generated-root" : "generated-section"}>{!root && <div className="generated-section-title"><strong>{group.title}</strong><span>{total} полей</span></div>}{group.fields.length > 0 && <div className="dynamic-fields">{group.fields.map((field) => <DynamicField field={field} eventId={eventId} preset={preset} key={field.key} />)}</div>}{group.children.map((child) => <FieldGroup group={child} eventId={eventId} preset={preset} key={child.title} />)}</section>;
}

function RemoteOptionsField({ field, eventId, defaultValue }: { field: RouteField; eventId: string; defaultValue: unknown }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<string[]>(field.options ?? []);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!field.optionsSource) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/integrations/catalog/options?eventId=${encodeURIComponent(eventId)}&fieldKey=${encodeURIComponent(field.key)}&query=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (response.ok && Array.isArray(data.options)) setOptions(data.options.map(String));
      } catch {} finally { setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [eventId, field.key, field.optionsSource, query]);
  return <label>{field.label}{field.required && <em>обязательно</em>}<input className="option-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск вариантов в XYOps…" aria-label={`Поиск вариантов: ${field.label}`} /><select name={field.key} required={field.required} defaultValue={String(defaultValue ?? "")}><option value="" disabled>{loading ? "Загрузка…" : "Выберите значение"}</option>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select><small>{loading ? "Получение вариантов из XYOps" : field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
}

function DynamicField({ field, eventId, preset = {} }: { field: RouteField; eventId: string; preset?: Record<string, string> }) {
  const defaultValue = preset[field.key] ?? field.default;
  if (field.type === "select" && field.optionsSource) return <RemoteOptionsField field={field} eventId={eventId} defaultValue={defaultValue} />;
  if (field.type === "boolean") return <label className="checkbox-field"><input name={field.key} type="checkbox" defaultChecked={defaultValue === true || defaultValue === "true"} /><span><strong>{field.label}</strong><small>{field.key} · {field.target ?? "params"}</small></span></label>;
  if (field.type === "select" && field.options?.length) return <label>{field.label}{field.required && <em>обязательно</em>}<select name={field.key} required={field.required} disabled={field.readOnly} defaultValue={String(defaultValue ?? field.options[0] ?? "")}><option value="" disabled>Выберите значение</option>{field.options.map((option) => <option value={option} key={option}>{option}</option>)}</select>{field.readOnly && <input type="hidden" name={field.key} value={String(defaultValue ?? "")} />}<small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  if (field.type === "select") return <label>{field.label}{field.required && <em>обязательно</em>}<input name={field.key} type="text" required={field.required} readOnly={field.readOnly} defaultValue={defaultValue === undefined ? "" : String(defaultValue)} placeholder={field.placeholder || field.key} /><small>{field.description || "XYOps не опубликовал список вариантов — разрешён ручной ввод"}</small></label>;
  if (field.type === "multiselect") return <label>{field.label}{field.required && <em>обязательно</em>}<select name={field.key} multiple required={field.required} defaultValue={Array.isArray(defaultValue) ? defaultValue : []}>{(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  if (field.type === "textarea" || field.type === "json") return <label className="field-wide">{field.label}{field.required && <em>обязательно</em>}<textarea name={field.key} required={field.required} readOnly={field.readOnly} defaultValue={defaultValue === undefined ? "" : typeof defaultValue === "string" ? defaultValue : JSON.stringify(defaultValue, null, 2)} placeholder={field.placeholder || (field.type === "json" ? "{ }" : field.key)} /><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
  const inputType = field.type === "number" ? "number" : field.type === "password" ? "password" : field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text";
  return <label>{field.label}{field.required && <em>обязательно</em>}<input name={field.key} type={inputType} required={field.required} readOnly={field.readOnly} pattern={field.pattern} min={field.min} max={field.max} defaultValue={defaultValue === undefined ? "" : String(defaultValue)} placeholder={field.placeholder || field.key} autoComplete={field.type === "password" ? "new-password" : undefined} /><small>{field.description || `${field.key} → ${field.target ?? "params"}`}</small></label>;
}
