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
  | "backup.restore.test";

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
  "backup.restore.test",
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
  "backup.restore.test": {
    title: "Проверка восстановления",
    shortTitle: "Test restore",
    description: "Проверка выбранных данных резервной копии в изолированном временном хранилище без изменения портала.",
    scope: "Portal",
  },
};

export const portalRolePermissions: Record<PortalRole, PortalPermission[]> = {
  viewer: ["directory.read"],
  operator: ["directory.read", "freeipa.write", "xyops.run"],
  admin: ["directory.read", "freeipa.write", "freeipa.delete", "xyops.run", "xyops.approve", "settings.manage", "backup.export", "backup.export.encrypted", "backup.restore.test"],
};

export function roleHasPermission(role: PortalRole, permission: PortalPermission): boolean {
  return portalRolePermissions[role].includes(permission);
}