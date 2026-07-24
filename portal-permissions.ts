export type PortalRole = "viewer" | "operator" | "admin";

export type PortalPermission =
  | "directory.read"
  | "freeipa.write"
  | "freeipa.delete"
  | "xyops.run"
  | "xyops.approve"
  | "settings.manage";

export const portalRoles: PortalRole[] = ["viewer", "operator", "admin"];

export const portalPermissionOrder: PortalPermission[] = [
  "directory.read",
  "freeipa.write",
  "freeipa.delete",
  "xyops.run",
  "xyops.approve",
  "settings.manage",
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
};

export const portalRolePermissions: Record<PortalRole, PortalPermission[]> = {
  viewer: ["directory.read"],
  operator: ["directory.read", "freeipa.write", "xyops.run"],
  admin: ["directory.read", "freeipa.write", "freeipa.delete", "xyops.run", "xyops.approve", "settings.manage"],
};

export function roleHasPermission(role: PortalRole, permission: PortalPermission): boolean {
  return portalRolePermissions[role].includes(permission);
}
