export const freeIpaOperations: ReadonlySet<string> = new Set([
  "user_add",
  "user_mod",
  "user_password",
  "user_enable",
  "user_disable",
  "user_del",
  "group_add",
  "group_del",
  "group_add_member",
  "group_remove_member",
] as const);

export type FreeIpaOperation = "user_add" | "user_mod" | "user_password" | "user_enable" | "user_disable" | "user_del" | "group_add" | "group_del" | "group_add_member" | "group_remove_member";

export function isFreeIpaOperation(value: unknown): value is FreeIpaOperation {
  return typeof value === "string" && freeIpaOperations.has(value as FreeIpaOperation);
}

function directText(source: Record<string, unknown>, keys: string[], maxLength = 255): string {
  for (const key of keys) {
    if (typeof source[key] !== "string") continue;
    const value = source[key].trim();
    if (value && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  }
  return "";
}

function directId(source: Record<string, unknown>, keys: string[], label: string): string {
  const value = directText(source, keys);
  if (!value || !/^[A-Za-z0-9_.@$-]+$/.test(value)) throw new Error(`Некорректное поле: ${label}`);
  return value;
}

function directSecret(source: Record<string, unknown>, keys: string[], maxLength = 1024): string {
  for (const key of keys) {
    if (typeof source[key] !== "string") continue;
    const value = source[key];
    if (value && value.length <= maxLength && !value.includes("\u0000")) return value;
  }
  return "";
}

export function freeIpaDirectCall(operation: FreeIpaOperation, body: Record<string, unknown>): { method: string; args: unknown[]; options: Record<string, unknown>; title: string; values: Record<string, unknown> } {
  const username = () => directId(body, ["username", "uid", "user"], "логин");
  const group = () => directId(body, ["group", "groupname", "cn"], "группа");
  if (operation === "user_add") {
    const uid = username();
    const givenname = directText(body, ["firstName", "givenname"]);
    const sn = directText(body, ["lastName", "sn"]);
    if (!givenname || !sn) throw new Error("Имя и фамилия обязательны");
    const mail = directText(body, ["email", "mail"]);
    const password = directSecret(body, ["password", "userpassword"]);
    const options: Record<string, unknown> = { givenname, sn };
    if (mail) options.mail = mail;
    if (password) options.userpassword = password;
    return { method: "user_add", args: [uid], options, title: "Создание пользователя FreeIPA", values: { uid, mail } };
  }
  if (operation === "user_mod") {
    const uid = username();
    const options: Record<string, unknown> = {};
    const givenname = directText(body, ["firstName", "givenname"]);
    const sn = directText(body, ["lastName", "sn"]);
    const mail = directText(body, ["email", "mail"]);
    if (givenname) options.givenname = givenname;
    if (sn) options.sn = sn;
    if (mail) options.mail = mail;
    if (!Object.keys(options).length) throw new Error("Укажите хотя бы одно изменяемое поле");
    return { method: "user_mod", args: [uid], options, title: "Редактирование пользователя FreeIPA", values: { uid, mail } };
  }
  if (operation === "user_password") {
    const uid = username();
    const password = directSecret(body, ["password", "userpassword"]);
    if (password.length < 8) throw new Error("Новый пароль должен содержать не менее 8 символов");
    return { method: "user_mod", args: [uid], options: { userpassword: password }, title: "Сброс пароля пользователя FreeIPA", values: { uid } };
  }
  if (operation === "user_enable" || operation === "user_disable" || operation === "user_del") {
    const uid = username();
    const titles = { user_enable: "Включение пользователя FreeIPA", user_disable: "Отключение пользователя FreeIPA", user_del: "Удаление пользователя FreeIPA" };
    return { method: operation, args: [uid], options: {}, title: titles[operation], values: { uid } };
  }
  if (operation === "group_add") {
    const cn = group();
    const description = directText(body, ["description"], 1024);
    return { method: "group_add", args: [cn], options: description ? { description } : {}, title: "Создание группы FreeIPA", values: { group: cn } };
  }
  if (operation === "group_del") {
    const cn = group();
    return { method: "group_del", args: [cn], options: {}, title: "Удаление группы FreeIPA", values: { group: cn } };
  }
  const cn = group();
  const uid = username();
  return {
    method: operation,
    args: [cn],
    options: { user: [uid] },
    title: operation === "group_add_member" ? "Добавление участника FreeIPA" : "Удаление участника FreeIPA",
    values: { group: cn, uid },
  };
}
