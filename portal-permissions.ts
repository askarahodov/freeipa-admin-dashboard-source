export type PortalRole = "viewer" | "operator" | "admin";

export type PortalPermission =
  | "directory.read"
  | "freeipa.write"
  | "freeipa.delete"
  | "xyops.run"
  | "xyops.approve"
  | "settings.manage"
  | "backup.export"
  | "backup.export.encrypted"
  | "backup.restore.preview"
  | "backup.restore.test"
  | "backup.restore.prepare"
  | "backup.restore.commit"
  | "backup.restore.cancel"
  | "maintenance.manage";

export const portalRoles: PortalRole[] = ["viewer", "operator", "admin"];

export const portalPermissionOrder: PortalPermission[] = [
  "directory.read",
  "freeipa.write",
  "freeipa.delete",
  "xyops.run",
  "xyops.approve",
  "settings.manage",
  "backup.export",
  "backup.export.encrypted",
  "backup.restore.preview",
  "backup.restore.test",
  "backup.restore.prepare",
  "backup.restore.commit",
  "backup.restore.cancel",
  "maintenance.manage",
];

export const portalRoleLabels: Record<PortalRole, string> = {
  viewer: "Наблюдатель",
  operator: "Оператор",
  admin: "Администратор",
};

export const portalPermissionMetadata: Record<PortalPermission, {
  title: string;
  shortTitle: string;
  description: string;
  scope: "Portal" | "FreeIPA" | "XYOps";
}> = {
  "directory.read": {
    title: "Просмотр портала и каталога",
    shortTitle: "Просмотр",
    description: "Пользователи и группы FreeIPA, каталог автоматизаций, операции и результаты.",
    scope: "Portal",
  },
  "freeipa.write": {
    title: "Изменение FreeIPA",
    shortTitle: "FreeIPA write",
    description: "Создание и редактирование пользователей и групп, membership, пароли, включение и отключение.",
    scope: "FreeIPA",
  },
  "freeipa.delete": {
    title: "Удаление объектов FreeIPA",
    shortTitle: "FreeIPA delete",
    description: "Удаление пользователей и групп FreeIPA.",
    scope: "FreeIPA",
  },
  "xyops.run": {
    title: "Запуск процессов XYOps",
    shortTitle: "XYOps run",
    description: "Запуск разрешённых Events и Workflows, остановка и безопасный повтор операций.",
    scope: "XYOps",
  },
  "xyops.approve": {
    title: "Согласование процессов XYOps",
    shortTitle: "XYOps approve",
    description: "Одобрение и отклонение опасных процессов, защищённых approval-политиками.",
    scope: "XYOps",
  },
  "settings.manage": {
    title: "Администрирование портала",
    shortTitle: "Управление",
    description: "Настройки, аудит, политики, метаданные каталога, диагностика, пользователи и сессии портала.",
    scope: "Portal",
  },
  "backup.export": {
    title: "Экспорт резервной копии",
    shortTitle: "Backup export",
    description: "Создание безопасной sanitised-выгрузки конфигурации и данных портала без секретов.",
    scope: "Portal",
  },
  "backup.export.encrypted": {
    title: "Полная зашифрованная резервная копия",
    shortTitle: "Encrypted backup",
    description: "Создание полной зашифрованной копии данных портала с отдельным пользовательским ключом.",
    scope: "Portal",
  },
  "backup.restore.preview": {
    title: "Предварительный просмотр восстановления",
    shortTitle: "Restore preview",
    description: "Безопасный read-only preview содержимого и совместимости резервной копии до тестового или production restore.",
    scope: "Portal",
  },
  "backup.restore.test": {
    title: "Проверка восстановления",
    shortTitle: "Test restore",
    description: "Проверка выбранных данных резервной копии в изолированном временном хранилище без изменения портала.",
    scope: "Portal",
  },
  "backup.restore.prepare": {
    title: "Подготовка восстановления",
    shortTitle: "Restore prepare",
    description: "Проверка selective restore, создание обязательной зашифрованной recovery point и временного commit stage.",
    scope: "Portal",
  },
  "backup.restore.commit": {
    title: "Применение восстановления",
    shortTitle: "Restore commit",
    description: "Транзакционное применение подготовленного selective restore после повторной проверки состояния и подтверждений.",
    scope: "Portal",
  },
  "backup.restore.cancel": {
    title: "Отмена восстановления",
    shortTitle: "Restore cancel",
    description: "Отмена ещё не применённого selective restore stage до начала транзакционного commit.",
    scope: "Portal",
  },
  "maintenance.manage": {
    title: "Режим обслуживания портала",
    shortTitle: "Maintenance",
    description: "Подготовка, вход, проверка и безопасное завершение режима обслуживания и восстановления.",
    scope: "Portal",
  },
};

export const portalRolePermissions: Record<PortalRole, PortalPermission[]> = {
  viewer: ["directory.read"],
  operator: ["directory.read", "freeipa.write", "xyops.run"],
  admin: [
    "directory.read",
    "freeipa.write",
    "freeipa.delete",
    "xyops.run",
    "xyops.approve",
    "settings.manage",
    "backup.export",
    "backup.export.encrypted",
    "backup.restore.preview",
    "backup.restore.test",
    "backup.restore.prepare",
    "backup.restore.commit",
    "backup.restore.cancel",
    "maintenance.manage",
  ],
};

export function isPortalRole(value: unknown): value is PortalRole {
  return value === "viewer" || value === "operator" || value === "admin";
}

export function resolvePortalRole(
  identity: string,
  defaultRole: unknown,
  assignmentsJson?: string,
  fallbackRole: PortalRole = "admin",
): PortalRole {
  const normalizedDefault = String(defaultRole ?? "").trim().toLowerCase();
  let role = isPortalRole(normalizedDefault) ? normalizedDefault : fallbackRole;
  if (!assignmentsJson) return role;

  try {
    const assignments = JSON.parse(assignmentsJson) as unknown;
    if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) return role;
    const normalized = Object.fromEntries(
      Object.entries(assignments as Record<string, unknown>)
        .map(([key, value]) => [key.trim().toLowerCase(), value]),
    );
    const exact = normalized[identity.trim().toLowerCase()];
    const wildcard = normalized["*"];
    return isPortalRole(exact) ? exact : isPortalRole(wildcard) ? wildcard : role;
  } catch {
    return role;
  }
}

export function roleHasPermission(role: PortalRole, permission: PortalPermission): boolean {
  return portalRolePermissions[role].includes(permission);
}
