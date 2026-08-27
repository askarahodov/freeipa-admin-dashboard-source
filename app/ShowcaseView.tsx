"use client";

import { useState } from "react";
import { TextInput } from "./ui/TextInput";
import { Select } from "./ui/Select";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { StatusBadge } from "./ui/StatusBadge";
import { Spinner } from "./ui/Spinner";
import { Skeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";
import { IconCheck, IconClose, IconWarning, IconPlay, IconRefresh, IconPlus, IconStorage } from "./icons";
import ThemeToggle from "./ThemeToggle";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ds-card" style={{ marginBottom: 24 }}>
      <div className="ds-card-header">
        <h2 style={{ fontSize: 18, margin: 0 }}>{title}</h2>
      </div>
      <div className="ds-card-body" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, control }: { label: string; control: React.ReactNode }) {
  return (
    <div className="ds-field" style={{ minWidth: 240 }}>
      <label>{label}</label>
      {control}
      <span className="ds-field-helper">Подсказка под полем ввода.</span>
    </div>
  );
}

export function ShowcaseView() {
  const { show } = useToast();
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState("a");
  const [toggle, setToggle] = useState(true);

  return (
    <main className="main" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <span className="eyebrow" style={{ color: "var(--muted)" }}>DESIGN SYSTEM</span>
          <h1 style={{ fontSize: 30, margin: "4px 0 0" }}>Витрина компонентов</h1>
          <p style={{ color: "var(--muted)", marginTop: 6 }}>Единая библиотека контролов, кнопок и состояний.</p>
        </div>
        <ThemeToggle />
      </div>

      <Section title="Кнопки">
        <Button variant="primary">Первичная</Button>
        <Button variant="secondary">Вторичная</Button>
        <Button variant="ghost">Призрачная</Button>
        <Button variant="danger">Опасная</Button>
        <Button variant="primary" size="sm">Маленькая</Button>
        <Button variant="primary" size="lg">Большая</Button>
        <Button variant="secondary" disabled>Отключена</Button>
        <IconButton aria-label="Запустить"><IconPlay size={16} /></IconButton>
        <IconButton aria-label="Обновить"><IconRefresh size={16} /></IconButton>
      </Section>

      <Section title="Поля ввода и валидация">
        <Field label="Имя (норма)" control={<TextInput placeholder="Введите имя" />} />
        <Field label="Email (ошибка)" control={<TextInput className="ds-error" defaultValue="not-an-email" aria-invalid />} />
        <Field label="Токен (успех)" control={<TextInput className="ds-success" defaultValue="••••••" />} />
        <Field label="Лимит (предупреждение)" control={<TextInput className="ds-warning" defaultValue="близко к лимиту" />} />
        <Field label="Роль" control={<Select defaultValue="admin"><option value="admin">Администратор</option><option value="operator">Оператор</option><option value="viewer">Наблюдатель</option></Select>} />
      </Section>

      <Section title="Чекбоксы, радио, переключатели">
        <label className="ds-checkbox"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />Активный</label>
        <label className="ds-radio"><input type="radio" name="r" checked={radio === "a"} onChange={() => setRadio("a")} />Вариант A</label>
        <label className="ds-radio"><input type="radio" name="r" checked={radio === "b"} onChange={() => setRadio("b")} />Вариант B</label>
        <label className="ds-toggle"><input type="checkbox" checked={toggle} onChange={(e) => setToggle(e.target.checked)} />Уведомления</label>
      </Section>

      <Section title="Бейджи и статусы">
        <StatusBadge tone="primary" badge>Primary</StatusBadge>
        <StatusBadge tone="success" badge>Success</StatusBadge>
        <StatusBadge tone="warning" badge>Warning</StatusBadge>
        <StatusBadge tone="danger" badge>Danger</StatusBadge>
        <StatusBadge tone="neutral" badge>Neutral</StatusBadge>
        <StatusBadge tone="info">Инфо</StatusBadge>
        <StatusBadge tone="success">Готово</StatusBadge>
      </Section>

      <Section title="Состояния загрузки">
        <Spinner />
        <Spinner size={28} />
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Spinner /> Загрузка данных…</span>
        <div style={{ display: "grid", gap: 8, width: 280 }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" width="80%" />
          <Skeleton variant="circle" width={40} height={40} />
        </div>
      </Section>

      <Section title="Уведомления (Toast)">
        <Button variant="secondary" onClick={() => show({ message: "Операция выполнена успешно", tone: "success" })}><IconCheck size={16} /> Success</Button>
        <Button variant="secondary" onClick={() => show({ message: "Произошла ошибка", tone: "error" })}><IconClose size={16} /> Error</Button>
        <Button variant="secondary" onClick={() => show({ message: "Требуется внимание", tone: "warning" })}><IconWarning size={16} /> Warning</Button>
        <Button variant="secondary" onClick={() => show({ message: "Создано", tone: "success", actionLabel: "Открыть", onAction: () => {} })}><IconPlus size={16} /> С действием</Button>
      </Section>

      <Section title="Таблица">
        <div style={{ width: "100%" }}>
          <table className="ds-table">
            <thead>
              <tr><th>Ресурс</th><th>Роль</th><th>Статус</th><th>Действие</th></tr>
            </thead>
            <tbody>
              <tr><td>freeipa.write</td><td>admin</td><td><StatusBadge tone="success" badge>Разрешено</StatusBadge></td><td><Button variant="ghost" size="sm">Открыть</Button></td></tr>
              <tr><td>xyops.run</td><td>operator</td><td><StatusBadge tone="warning" badge>Ожидает</StatusBadge></td><td><Button variant="ghost" size="sm">Открыть</Button></td></tr>
              <tr><td>settings.manage</td><td>viewer</td><td><StatusBadge tone="danger" badge>Запрещено</StatusBadge></td><td><Button variant="ghost" size="sm">Открыть</Button></td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Пустое состояние">
        <div className="ds-empty" style={{ width: "100%" }}>
          <span className="icon"><IconStorage size={48} /></span>
          <strong>Нет данных</strong>
          <span>Здесь появятся записи после первой синхронизации.</span>
        </div>
      </Section>
    </main>
  );
}
