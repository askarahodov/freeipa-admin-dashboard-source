"use client";

import { useState } from "react";
import type { FreeIpaAction } from "../../freeipa-ui-events";
import { Button, DataListPage, DataListState, DataTable, Toolbar } from "../ui";

export type DirectoryUser = { uid: string; name: string; firstName: string; lastName: string; email: string; groups: number; groupNames: string[]; active: boolean };
export type DirectoryGroup = { name: string; description: string; members: number; memberUids: string[]; type: string };
export type DirectorySource = "demo" | "live" | "unconfigured";

function Status({ children, tone = "success" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export function Users({ items, allGroups, total, source, canWrite, canDelete, onCreate, onAction }: { items: DirectoryUser[]; allGroups: DirectoryGroup[]; total: number; source: DirectorySource; canWrite: boolean; canDelete: boolean; onCreate: () => void; onAction: (action: FreeIpaAction) => void }) {
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("all");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const visible = items.filter((user) => filter === "all" || (filter === "active" ? user.active : !user.active));
  const selected = items.find((user) => user.uid === selectedUid) ?? null;
  const sourceLabel = source === "live" ? "прямое подключение FreeIPA" : source === "demo" ? "демо-данные" : "FreeIPA не настроен";
  const hasFilteredEmpty = source !== "unconfigured" && items.length > 0 && visible.length === 0;

  return <>
    <DataListPage
      title="Пользователи FreeIPA"
      description={`${visible.length} из ${total} учетных записей · ${sourceLabel}`}
      actions={canWrite ? <Button variant="primary" disabled={source === "unconfigured"} onClick={onCreate}>Создать пользователя</Button> : <Status tone="neutral">Только просмотр</Status>}
      toolbar={<Toolbar aria-label="Фильтры пользователей"><Button variant={filter === "all" ? "primary" : "secondary"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Все</Button><Button variant={filter === "active" ? "primary" : "secondary"} aria-pressed={filter === "active"} onClick={() => setFilter("active")}>Активные</Button><Button variant={filter === "disabled" ? "primary" : "secondary"} aria-pressed={filter === "disabled"} onClick={() => setFilter("disabled")}>Отключённые</Button></Toolbar>}
    >
      {source === "unconfigured" ? <DataListState kind="error" title="FreeIPA не настроен" description="Сохраните подключение в разделе «Настройки»." /> : hasFilteredEmpty ? <DataListState kind="filtered-empty" title="Пользователи не найдены" description="Измените выбранный фильтр." /> : visible.length === 0 ? <DataListState kind="empty" title="Пользователей пока нет" description="В каталоге FreeIPA нет учетных записей для отображения." /> : <DataTable label="Пользователи FreeIPA"><thead><tr><th>Пользователь</th><th>Логин</th><th>Группы</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{visible.map((u) => <tr key={u.uid}><td><span className="person"><b>{u.name.split(" ").map((part) => part[0]).join("")}</b><span><strong>{u.name}</strong><small>{u.email}</small></span></span></td><td className="mono">{u.uid}</td><td>{u.groups}</td><td><Status tone={u.active ? "success" : "neutral"}>{u.active ? "Активен" : "Отключён"}</Status></td><td><span className="row-actions"><Button variant="ghost" onClick={() => setSelectedUid(u.uid)}>Карточка</Button>{canWrite && <Button variant="secondary" onClick={() => onAction({ operation: "user_mod", title: `Редактировать ${u.uid}`, preset: { username: u.uid, firstName: u.firstName, lastName: u.lastName, email: u.email } })}>Редактировать</Button>}</span></td></tr>)}</tbody></DataTable>}
    </DataListPage>
    {selected && <UserDetails user={selected} groups={allGroups} canWrite={canWrite} canDelete={canDelete} close={() => setSelectedUid(null)} action={onAction} />}
  </>;
}

export function Groups({ items, allUsers, source, canWrite, canDelete, onCreate, onAction }: { items: DirectoryGroup[]; allUsers: DirectoryUser[]; source: DirectorySource; canWrite: boolean; canDelete: boolean; onCreate: () => void; onAction: (action: FreeIpaAction) => void }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = items.find((group) => group.name === selectedName) ?? null;
  const sourceLabel = source === "live" ? "прямое подключение FreeIPA" : source === "demo" ? "демо-данные" : "FreeIPA не настроен";

  return <>
    <DataListPage
      title="Группы доступа"
      description={`${items.length} групп · ${sourceLabel}`}
      actions={canWrite ? <Button variant="primary" disabled={source === "unconfigured"} onClick={onCreate}>Создать группу</Button> : <Status tone="neutral">Только просмотр</Status>}
    >
      {source === "unconfigured" ? <DataListState kind="error" title="FreeIPA не настроен" description="Сохраните подключение в разделе «Настройки»." /> : items.length === 0 ? <DataListState kind="empty" title="Групп пока нет" description="В каталоге FreeIPA нет групп для отображения." /> : <DataTable label="Группы доступа"><thead><tr><th>Группа</th><th>Описание</th><th>Участники</th><th>Тип</th><th>Действия</th></tr></thead><tbody>{items.map((group) => <tr key={group.name}><td><strong>{group.name}</strong></td><td>{group.description}</td><td>{group.members}</td><td><Status tone="violet">{group.type}</Status></td><td><span className="row-actions"><Button variant="ghost" onClick={() => setSelectedName(group.name)}>Открыть группу</Button>{canWrite && <Button variant="secondary" onClick={() => onAction({ operation: "group_add_member", title: `Добавить участника в ${group.name}`, preset: { group: group.name }, choices: { users: allUsers.filter((user) => !group.memberUids.includes(user.uid)).map((user) => user.uid) } })}>Добавить участника</Button>}</span></td></tr>)}</tbody></DataTable>}
    </DataListPage>
    {selected && <GroupDetails group={selected} users={allUsers} canWrite={canWrite} canDelete={canDelete} close={() => setSelectedName(null)} action={onAction} />}
  </>;
}

function UserDetails({ user, groups, canWrite, canDelete, close, action }: { user: DirectoryUser; groups: DirectoryGroup[]; canWrite: boolean; canDelete: boolean; close: () => void; action: (action: FreeIpaAction) => void }) {
  const availableGroups = groups.filter((group) => !user.groupNames.includes(group.name)).map((group) => group.name);
  return <div className="modal-backdrop"><section className="modal identity-modal"><button className="modal-x" onClick={close}>×</button><div className="identity-head"><span>{user.name.split(" ").map((part) => part[0]).join("")}</span><div><small>ПОЛЬЗОВАТЕЛЬ FREEIPA</small><h2>{user.name}</h2><code>{user.uid}</code></div><Status tone={user.active ? "success" : "neutral"}>{user.active ? "Активен" : "Отключён"}</Status></div><div className="identity-facts"><span><small>Email</small><strong>{user.email || "Не указан"}</strong></span><span><small>Группы</small><strong>{user.groups}</strong></span></div><div className="membership-head"><div><h3>Членство в группах</h3><p>{canWrite ? "Изменения применяются напрямую в FreeIPA." : "Доступно только для просмотра."}</p></div>{canWrite && <button className="secondary" disabled={!availableGroups.length} onClick={() => action({ operation: "group_add_member", title: `Добавить ${user.uid} в группу`, preset: { username: user.uid }, choices: { groups: availableGroups } })}>＋ Добавить группу</button>}</div><div className="membership-list">{user.groupNames.map((group) => <span key={group}><b>{group}</b>{canWrite && <button data-portal-confirmation-control="1" aria-label={`Удалить ${user.uid} из ${group}`} onClick={() => action({ operation: "group_remove_member", title: `Удалить ${user.uid} из ${group}`, preset: { username: user.uid, group } })}>×</button>}</span>)}{!user.groupNames.length && <p>Пользователь не входит в группы.</p>}</div><div className="identity-actions">{canWrite && <><button className="secondary" onClick={() => action({ operation: "user_mod", title: `Редактировать ${user.uid}`, preset: { username: user.uid, firstName: user.firstName, lastName: user.lastName, email: user.email } })}>Редактировать</button><button className="secondary" onClick={() => action({ operation: "user_password", title: `Сбросить пароль ${user.uid}`, preset: { username: user.uid } })}>Сбросить пароль</button><button className="secondary" data-portal-confirmation-control={user.active ? "1" : undefined} onClick={() => action({ operation: user.active ? "user_disable" : "user_enable", title: `${user.active ? "Отключить" : "Включить"} ${user.uid}`, preset: { username: user.uid } })}>{user.active ? "Отключить" : "Включить"}</button></>}{canDelete && <button className="danger-button" data-portal-confirmation-control="1" onClick={() => action({ operation: "user_del", title: `Удалить ${user.uid}`, preset: { username: user.uid } })}>Удалить</button>}<button className="secondary" onClick={close}>Закрыть</button></div></section></div>;
}

function GroupDetails({ group, users, canWrite, canDelete, close, action }: { group: DirectoryGroup; users: DirectoryUser[]; canWrite: boolean; canDelete: boolean; close: () => void; action: (action: FreeIpaAction) => void }) {
  const availableUsers = users.filter((user) => !group.memberUids.includes(user.uid)).map((user) => user.uid);
  return <div className="modal-backdrop"><section className="modal identity-modal"><button className="modal-x" onClick={close}>×</button><div className="identity-head"><span>♣</span><div><small>ГРУППА FREEIPA</small><h2>{group.name}</h2><p>{group.description}</p></div><Status tone="violet">{group.type}</Status></div><div className="membership-head"><div><h3>Участники</h3><p>{group.members} пользователей в группе.</p></div>{canWrite && <button className="primary" disabled={!availableUsers.length} onClick={() => action({ operation: "group_add_member", title: `Добавить участника в ${group.name}`, preset: { group: group.name }, choices: { users: availableUsers } })}>＋ Добавить</button>}</div><div className="member-table">{group.memberUids.map((uid) => { const user = users.find((item) => item.uid === uid); return <div key={uid}><span className="person"><b>{(user?.name || uid).split(" ").map((part) => part[0]).join("")}</b><span><strong>{user?.name || uid}</strong><small>{user?.email || uid}</small></span></span><Status tone={user?.active === false ? "neutral" : "success"}>{user?.active === false ? "Отключён" : "Активен"}</Status>{canWrite && <button className="danger-link" data-portal-confirmation-control="1" onClick={() => action({ operation: "group_remove_member", title: `Удалить ${uid} из ${group.name}`, preset: { group: group.name, username: uid } })}>Удалить</button>}</div>; })}{!group.memberUids.length && <p>В группе пока нет участников.</p>}</div><div className="identity-actions">{canDelete && <button className="danger-button" data-portal-confirmation-control="1" onClick={() => action({ operation: "group_del", title: `Удалить группу ${group.name}`, preset: { group: group.name } })}>Удалить группу</button>}<button className="secondary" onClick={close}>Закрыть</button></div></section></div>;
}
