from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(content: str, before: str, after: str, label: str) -> str:
    count = content.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return content.replace(before, after, 1)


EVENTS_MODULE = '''export type FreeIpaOperation =
  | "user_add"
  | "user_mod"
  | "user_password"
  | "user_enable"
  | "user_disable"
  | "user_del"
  | "group_add"
  | "group_del"
  | "group_add_member"
  | "group_remove_member";

export type FreeIpaAction = {
  operation: FreeIpaOperation;
  title: string;
  preset: Record<string, string>;
  choices?: { users?: string[]; groups?: string[] };
};

export type FreeIpaAccess = {
  canWrite: boolean;
  canDelete: boolean;
};

export const FREEIPA_OPEN_ACTION_EVENT = "portal:freeipa:open-action";
export const FREEIPA_DIRECTORY_CHANGED_EVENT = "portal:freeipa:directory-changed";

export function openFreeIpaAction(action: FreeIpaAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FreeIpaAction>(FREEIPA_OPEN_ACTION_EVENT, { detail: action }));
}

export function announceFreeIpaDirectoryChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FREEIPA_DIRECTORY_CHANGED_EVENT));
}

export async function loadFreeIpaAccess(): Promise<FreeIpaAccess> {
  const response = await fetch("/api/integrations/status", { cache: "no-store" });
  if (!response.ok) return { canWrite: false, canDelete: false };
  const data = await response.json().catch(() => ({})) as { access?: { permissions?: unknown } };
  const permissions = Array.isArray(data.access?.permissions) ? data.access.permissions.map(String) : [];
  return {
    canWrite: permissions.includes("freeipa.write"),
    canDelete: permissions.includes("freeipa.delete"),
  };
}
'''


def refactor_page() -> None:
    path = "app/page.tsx"
    content = read(path)
    content = replace_once(
        content,
        'import { conditionFieldNames, fieldConditionMatches } from "../field-conditions";\n',
        'import { conditionFieldNames, fieldConditionMatches } from "../field-conditions";\nimport { FREEIPA_DIRECTORY_CHANGED_EVENT, FREEIPA_OPEN_ACTION_EVENT, announceFreeIpaDirectoryChanged, type FreeIpaAction, type FreeIpaOperation } from "../freeipa-ui-events";\n',
        "page import",
    )
    content = replace_once(
        content,
        'type FreeIpaOperation = "user_add" | "user_mod" | "user_password" | "user_enable" | "user_disable" | "user_del" | "group_add" | "group_del" | "group_add_member" | "group_remove_member";\ntype FreeIpaAction = { operation: FreeIpaOperation; title: string; preset: Record<string, string>; choices?: { users?: string[]; groups?: string[] } };\n',
        '',
        "page local FreeIPA types",
    )
    load_effect = '''  useEffect(() => {
    const timer = window.setTimeout(() => void loadDirectory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDirectory]);
'''
    event_effect = load_effect + '''
  useEffect(() => {
    const openAction = (event: Event) => {
      const action = (event as CustomEvent<FreeIpaAction>).detail;
      if (action) setFreeIpaAction(action);
    };
    const refreshDirectory = () => void loadDirectory();
    window.addEventListener(FREEIPA_OPEN_ACTION_EVENT, openAction);
    window.addEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refreshDirectory);
    return () => {
      window.removeEventListener(FREEIPA_OPEN_ACTION_EVENT, openAction);
      window.removeEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refreshDirectory);
    };
  }, [loadDirectory]);
'''
    content = replace_once(content, load_effect, event_effect, "page FreeIPA event listeners")
    content = replace_once(
        content,
        '      await loadDirectory();\n      await loadRuns(false);',
        '      announceFreeIpaDirectoryChanged();\n      await loadRuns(false);',
        "page action refresh",
    )
    content = replace_once(
        content,
        '<button aria-label={`Удалить ${user.uid} из ${group}`} onClick={() => action({ operation: "group_remove_member", title: `Удалить ${user.uid} из ${group}`, preset: { username: user.uid, group } })}>×</button>',
        '<button data-portal-confirmation-control="1" aria-label={`Удалить ${user.uid} из ${group}`} onClick={() => action({ operation: "group_remove_member", title: `Удалить ${user.uid} из ${group}`, preset: { username: user.uid, group } })}>×</button>',
        "user membership confirmation control",
    )
    content = replace_once(
        content,
        '<button className="secondary" onClick={() => action({ operation: user.active ? "user_disable" : "user_enable", title: `${user.active ? "Отключить" : "Включить"} ${user.uid}`, preset: { username: user.uid } })}>{user.active ? "Отключить" : "Включить"}</button>',
        '<button className="secondary" data-portal-confirmation-control={user.active ? "1" : undefined} onClick={() => action({ operation: user.active ? "user_disable" : "user_enable", title: `${user.active ? "Отключить" : "Включить"} ${user.uid}`, preset: { username: user.uid } })}>{user.active ? "Отключить" : "Включить"}</button>',
        "user toggle confirmation control",
    )
    content = replace_once(
        content,
        '<button className="danger-button" onClick={() => action({ operation: "user_del", title: `Удалить ${user.uid}`, preset: { username: user.uid } })}>Удалить</button>',
        '<button className="danger-button" data-portal-confirmation-control="1" onClick={() => action({ operation: "user_del", title: `Удалить ${user.uid}`, preset: { username: user.uid } })}>Удалить</button>',
        "user delete confirmation control",
    )
    content = replace_once(
        content,
        '<button className="danger-link" onClick={() => action({ operation: "group_remove_member", title: `Удалить ${uid} из ${group.name}`, preset: { group: group.name, username: uid } })}>Удалить</button>',
        '<button className="danger-link" data-portal-confirmation-control="1" onClick={() => action({ operation: "group_remove_member", title: `Удалить ${uid} из ${group.name}`, preset: { group: group.name, username: uid } })}>Удалить</button>',
        "group member confirmation control",
    )
    content = replace_once(
        content,
        '<button className="danger-button" onClick={() => action({ operation: "group_del", title: `Удалить группу ${group.name}`, preset: { group: group.name } })}>Удалить группу</button>',
        '<button className="danger-button" data-portal-confirmation-control="1" onClick={() => action({ operation: "group_del", title: `Удалить группу ${group.name}`, preset: { group: group.name } })}>Удалить группу</button>',
        "group delete confirmation control",
    )
    content = replace_once(
        content,
        '<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Отмена</button><button className="primary" disabled={busy}>{busy ? "Выполнение…" : "Применить в FreeIPA"}</button></div>',
        '<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Отмена</button><button className="primary" disabled={busy} data-portal-confirmation-control={destructive ? "1" : undefined}>{busy ? "Выполнение…" : "Применить в FreeIPA"}</button></div>',
        "FreeIPA modal confirmation control",
    )
    write(path, content)


USER_DETAILS = '''function FreeIpaUserDetails({ user, groups, canWrite, canDelete, close }: { user: FreeIpaDirectoryUser; groups: string[]; canWrite: boolean; canDelete: boolean; close: () => void }) {
  const availableGroups = groups.filter((group) => !user.groupNames.includes(group));
  return <div className="modal-backdrop"><section className="modal identity-modal"><button className="modal-x" onClick={close}>×</button><div className="identity-head"><span>{initials(user)}</span><div><small>ПОЛЬЗОВАТЕЛЬ FREEIPA</small><h2>{user.name || user.uid}</h2><code>{user.uid}</code></div><span className={`freeipa-user-status ${user.active ? "active" : "disabled"}`}>{user.active ? "Активен" : "Отключён"}</span></div><div className="identity-facts"><span><small>Email</small><strong>{user.email || "Не указан"}</strong></span><span><small>Группы</small><strong>{user.groups}</strong></span></div><div className="membership-head"><div><h3>Членство в группах</h3><p>{canWrite ? "Изменения применяются напрямую в FreeIPA." : "Доступно только для просмотра."}</p></div>{canWrite && <button className="secondary" disabled={!availableGroups.length} onClick={() => openFreeIpaAction({ operation: "group_add_member", title: `Добавить ${user.uid} в группу`, preset: { username: user.uid }, choices: { groups: availableGroups } })}>＋ Добавить группу</button>}</div><div className="membership-list">{user.groupNames.map((group) => <span key={group}><b>{group}</b>{canWrite && <button data-portal-confirmation-control="1" aria-label={`Удалить ${user.uid} из ${group}`} onClick={() => openFreeIpaAction({ operation: "group_remove_member", title: `Удалить ${user.uid} из ${group}`, preset: { username: user.uid, group } })}>×</button>}</span>)}{!user.groupNames.length && <p>Пользователь не входит в группы.</p>}</div><div className="identity-actions">{canWrite && <><button className="secondary" onClick={() => openFreeIpaAction({ operation: "user_mod", title: `Редактировать ${user.uid}`, preset: { username: user.uid, firstName: user.firstName, lastName: user.lastName, email: user.email } })}>Редактировать</button><button className="secondary" onClick={() => openFreeIpaAction({ operation: "user_password", title: `Сбросить пароль ${user.uid}`, preset: { username: user.uid } })}>Сбросить пароль</button><button className="secondary" data-portal-confirmation-control={user.active ? "1" : undefined} onClick={() => openFreeIpaAction({ operation: user.active ? "user_disable" : "user_enable", title: `${user.active ? "Отключить" : "Включить"} ${user.uid}`, preset: { username: user.uid } })}>{user.active ? "Отключить" : "Включить"}</button></>}{canDelete && <button className="danger-button" data-portal-confirmation-control="1" onClick={() => openFreeIpaAction({ operation: "user_del", title: `Удалить ${user.uid}`, preset: { username: user.uid } })}>Удалить</button>}<button className="secondary" onClick={close}>Закрыть</button></div></section></div>;
}

'''


def refactor_user_browser() -> None:
    path = "app/FreeIpaUserBrowser.tsx"
    content = read(path)
    content = replace_once(
        content,
        'import type { FreeIpaDirectoryUser, FreeIpaSortDirection, FreeIpaUserSort, FreeIpaUserStatus } from "../freeipa-user-query";\n',
        'import type { FreeIpaDirectoryUser, FreeIpaSortDirection, FreeIpaUserSort, FreeIpaUserStatus } from "../freeipa-user-query";\nimport { FREEIPA_DIRECTORY_CHANGED_EVENT, announceFreeIpaDirectoryChanged, loadFreeIpaAccess, openFreeIpaAction } from "../freeipa-ui-events";\n',
        "user browser import",
    )
    legacy_block = '''function legacyUserButton(uid: string, label: string): HTMLButtonElement | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".section-page .data-table .tr.users-row:not(.th)"));
  const row = rows.find((item) => item.querySelector(".mono")?.textContent?.trim() === uid);
  return Array.from(row?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => button.textContent?.trim() === label) ?? null;
}

function legacyCreateButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(".section-page > .panel-title button.primary");
}

function clickLegacyCreate(): void {
  legacyCreateButton()?.click();
}

function clickLegacyUser(uid: string, label: "Карточка" | "Редактировать"): void {
  legacyUserButton(uid, label)?.click();
}

'''
    content = replace_once(content, legacy_block, "", "user browser legacy helpers")
    content = replace_once(content, 'export default function FreeIpaUserBrowser() {\n', USER_DETAILS + 'export default function FreeIpaUserBrowser() {\n', "user details component")
    content = replace_once(
        content,
        '  const [canWrite, setCanWrite] = useState(false);\n  const [selected, setSelected] = useState<Set<string>>(() => new Set());',
        '  const [canWrite, setCanWrite] = useState(false);\n  const [canDelete, setCanDelete] = useState(false);\n  const [selectedUid, setSelectedUid] = useState<string | null>(null);\n  const [selected, setSelected] = useState<Set<string>>(() => new Set());',
        "user browser access state",
    )
    content = replace_once(content, '  const lastFreeIpaToast = useRef("");\n', '', "user browser toast ref")
    old_access_effect = '''  useEffect(() => {
    if (!active || !mount) return;
    const timer = window.setTimeout(() => setCanWrite(Boolean(legacyCreateButton())), 0);
    return () => window.clearTimeout(timer);
  }, [active, mount, payload?.mode]);
'''
    new_access_effect = '''  useEffect(() => {
    if (!active) {
      setCanWrite(false);
      setCanDelete(false);
      return;
    }
    let cancelled = false;
    void loadFreeIpaAccess().then((access) => {
      if (cancelled) return;
      setCanWrite(access.canWrite);
      setCanDelete(access.canDelete);
    }).catch(() => {
      if (cancelled) return;
      setCanWrite(false);
      setCanDelete(false);
    });
    return () => { cancelled = true; };
  }, [active]);
'''
    content = replace_once(content, old_access_effect, new_access_effect, "user browser access effect")
    old_toast_effect = '''  useEffect(() => {
    if (!active) return;
    const observer = new MutationObserver(() => {
      const message = document.querySelector<HTMLElement>(".toast")?.textContent?.trim() ?? "";
      if (!message) {
        lastFreeIpaToast.current = "";
        return;
      }
      if (message.includes("FreeIPA") && message !== lastFreeIpaToast.current) {
        lastFreeIpaToast.current = message;
        void load();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, load]);
'''
    new_event_effect = '''  useEffect(() => {
    if (!active) return;
    const refresh = () => void load();
    window.addEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refresh);
  }, [active, load]);

  useEffect(() => {
    if (selectedUid && payload && !payload.users.some((user) => user.uid === selectedUid)) setSelectedUid(null);
  }, [payload, selectedUid]);
'''
    content = replace_once(content, old_toast_effect, new_event_effect, "user browser directory event")
    content = replace_once(content, '      await load();\n', '      await load();\n      announceFreeIpaDirectoryChanged();\n', "user browser bulk directory event")
    content = replace_once(
        content,
        'onClick={clickLegacyCreate}>＋ Создать пользователя</button>',
        'onClick={() => openFreeIpaAction({ operation: "user_add", title: "Новый пользователь", preset: {} })}>＋ Создать пользователя</button>',
        "user browser create action",
    )
    content = replace_once(
        content,
        '<button onClick={() => clickLegacyUser(user.uid, "Карточка")}>Карточка</button>{canWrite && <button onClick={() => clickLegacyUser(user.uid, "Редактировать")}>Редактировать</button>}',
        '<button onClick={() => setSelectedUid(user.uid)}>Карточка</button>{canWrite && <button onClick={() => openFreeIpaAction({ operation: "user_mod", title: `Редактировать ${user.uid}`, preset: { username: user.uid, firstName: user.firstName, lastName: user.lastName, email: user.email } })}>Редактировать</button>}',
        "user browser row actions",
    )
    content = replace_once(
        content,
        '  const groups = payload?.filters.availableGroups ?? [];\n',
        '  const groups = payload?.filters.availableGroups ?? [];\n  const selectedUser = selectedUid ? users.find((user) => user.uid === selectedUid) ?? null : null;\n',
        "user browser selected user",
    )
    content = replace_once(content, '  return createPortal(\n    <div className="freeipa-user-browser-shell">', '  return createPortal(\n    <>\n    <div className="freeipa-user-browser-shell">', "user browser portal fragment")
    content = replace_once(
        content,
        '    </div>,\n    mount,\n  );',
        '    </div>\n    {selectedUser && <FreeIpaUserDetails user={selectedUser} groups={groups} canWrite={canWrite} canDelete={canDelete} close={() => setSelectedUid(null)} />}\n    </>,\n    mount,\n  );',
        "user browser details portal",
    )
    write(path, content)


def refactor_group_members() -> None:
    path = "app/FreeIpaGroupMemberBrowser.tsx"
    content = read(path)
    content = replace_once(
        content,
        '} from "../freeipa-group-member-query";\n',
        '} from "../freeipa-group-member-query";\nimport { FREEIPA_DIRECTORY_CHANGED_EVENT, loadFreeIpaAccess, openFreeIpaAction } from "../freeipa-ui-events";\n',
        "group member import",
    )
    legacy_remove = '''function legacyRemove(target: GroupMount, memberUids: string[], uid: string): boolean {
  const index = memberUids.indexOf(uid);
  if (index < 0) return false;
  const rows = Array.from(target.modal.querySelectorAll<HTMLElement>(".member-table > div"));
  const button = rows[index]?.querySelector<HTMLButtonElement>("button.danger-link");
  if (!button) return false;
  button.click();
  return true;
}

'''
    content = replace_once(content, legacy_remove, "", "group member legacy remove")
    content = replace_once(content, '  const lastFreeIpaToast = useRef("");\n', '', "group member toast ref")
    old_reset = '''  useEffect(() => {
    if (!modal || !groupName) return;
    const timer = window.setTimeout(() => {
      setQuery(defaultQuery);
      setDraft("");
      setPayload(null);
      setError("");
      setCanWrite(Boolean(modal.querySelector(".membership-head button.primary")));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [groupName, modal]);
'''
    new_reset = '''  useEffect(() => {
    if (!modal || !groupName) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setQuery(defaultQuery);
      setDraft("");
      setPayload(null);
      setError("");
    }, 0);
    void loadFreeIpaAccess().then((access) => {
      if (!cancelled) setCanWrite(access.canWrite);
    }).catch(() => {
      if (!cancelled) setCanWrite(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [groupName, modal]);
'''
    content = replace_once(content, old_reset, new_reset, "group member access effect")
    old_toast = '''  useEffect(() => {
    if (!active || !modal) return;
    const observer = new MutationObserver(() => {
      const message = document.querySelector<HTMLElement>(".toast")?.textContent?.trim() ?? "";
      if (!message) {
        lastFreeIpaToast.current = "";
        return;
      }
      if (message.includes("FreeIPA") && message !== lastFreeIpaToast.current) {
        lastFreeIpaToast.current = message;
        void load();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, load, modal]);
'''
    new_event = '''  useEffect(() => {
    if (!active || !modal) return;
    const refresh = () => void load();
    window.addEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, refresh);
  }, [active, load, modal]);
'''
    content = replace_once(content, old_toast, new_event, "group member directory event")
    content = replace_once(
        content,
        '{canWrite ? <button className="danger-link" onClick={() => { if (!payload || !legacyRemove(target, payload.group.memberUids, member.uid)) setError("Не удалось открыть существующее действие удаления участника"); }}>Удалить</button> : <span />}',
        '{canWrite ? <button className="danger-link" data-portal-confirmation-control="1" onClick={() => openFreeIpaAction({ operation: "group_remove_member", title: `Удалить ${member.uid} из ${groupName}`, preset: { group: groupName, username: member.uid } })}>Удалить</button> : <span />}',
        "group member direct action",
    )
    write(path, content)


def refactor_layout() -> None:
    path = "app/layout.tsx"
    content = read(path)
    content = replace_once(content, 'import FreeIpaDirectorySync from "./FreeIpaDirectorySync";\n', '', "layout directory sync import")
    content = replace_once(content, 'import FreeIpaLegacyActionBridge from "./FreeIpaLegacyActionBridge";\n', '', "layout action bridge import")
    content = replace_once(content, '        <FreeIpaDirectorySync />\n', '', "layout directory sync component")
    content = replace_once(content, '        <FreeIpaLegacyActionBridge />\n', '', "layout action bridge component")
    write(path, content)


write("freeipa-ui-events.ts", EVENTS_MODULE)
refactor_page()
refactor_user_browser()
refactor_group_members()
refactor_layout()

for obsolete in [
    "app/FreeIpaDirectorySync.tsx",
    "app/FreeIpaLegacyActionBridge.tsx",
    "scripts/apply_freeipa_ui_refactor.py",
    ".github/workflows/apply-freeipa-ui-refactor.yml",
]:
    target = ROOT / obsolete
    if target.exists():
        target.unlink()

for path in ["app/page.tsx", "app/FreeIpaUserBrowser.tsx", "app/FreeIpaGroupMemberBrowser.tsx", "app/layout.tsx"]:
    source = read(path)
    if "clickLegacy" in source or "legacyRemove" in source or "lastFreeIpaToast" in source:
        raise RuntimeError(f"legacy FreeIPA UI dependency remains in {path}")

print("FreeIPA UI refactor applied successfully")
