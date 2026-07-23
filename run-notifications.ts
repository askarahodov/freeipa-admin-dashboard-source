export type NotificationStatus = "success" | "failed" | "cancelled";

export type PublicRunNotification = {
  id: string;
  runId: string;
  status: NotificationStatus;
  title: string;
  message: string;
  createdAt: number;
  readAt: number | null;
};

type NotificationEnv = { DB?: D1Database };

type NotificationRun = {
  id: string;
  eventId: string;
  title: string;
  subject: string;
  status: string;
  completedAt: number | null;
};

const createNotificationsTable = `CREATE TABLE IF NOT EXISTS operation_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

const createNotificationReadsTable = `CREATE TABLE IF NOT EXISTS operation_notification_reads (
  notification_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (notification_id, identity)
)`;

function cleanText(value: unknown, limit: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, limit);
}

function notificationStatus(value: unknown): NotificationStatus | null {
  return value === "success" || value === "failed" || value === "cancelled" ? value : null;
}

async function ensureNotificationTables(env: NotificationEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createNotificationsTable).run();
  await env.DB.prepare(createNotificationReadsTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_notifications_created_idx ON operation_notifications(created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_notification_reads_identity_idx ON operation_notification_reads(identity, read_at DESC)").run();
}

function notificationMessage(run: NotificationRun, status: NotificationStatus): string {
  const title = cleanText(run.title, 180) || "XYOps";
  const subject = cleanText(run.subject, 180);
  const object = subject && subject !== "—" ? ` для «${subject}»` : "";
  if (status === "success") return `Задание «${title}»${object} завершено успешно.`;
  if (status === "cancelled") return `Задание «${title}»${object} остановлено.`;
  return `Задание «${title}»${object} завершилось с ошибкой.`;
}

export async function saveRunNotification(env: NotificationEnv, run: NotificationRun): Promise<void> {
  if (!env.DB || !run.id || run.eventId.startsWith("freeipa:")) return;
  const status = notificationStatus(run.status);
  if (!status) return;
  await ensureNotificationTables(env);
  const createdAt = typeof run.completedAt === "number" && Number.isFinite(run.completedAt) && run.completedAt > 0 ? run.completedAt : Date.now();
  const title = status === "success" ? "Задание XYOps завершено" : status === "cancelled" ? "Задание XYOps остановлено" : "Ошибка задания XYOps";
  await env.DB.prepare("INSERT OR IGNORE INTO operation_notifications (id, run_id, status, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(run.id.slice(0, 160), run.id.slice(0, 160), status, title, notificationMessage(run, status), createdAt).run();
  await env.DB.prepare("DELETE FROM operation_notifications WHERE id NOT IN (SELECT id FROM operation_notifications ORDER BY created_at DESC LIMIT 500)").run();
  await env.DB.prepare("DELETE FROM operation_notification_reads WHERE notification_id NOT IN (SELECT id FROM operation_notifications)").run();
}

function publicNotification(row: Record<string, unknown>): PublicRunNotification | null {
  const id = cleanText(row.id, 160);
  const status = notificationStatus(row.status);
  if (!id || !status) return null;
  return {
    id,
    runId: cleanText(row.run_id, 160),
    status,
    title: cleanText(row.title, 180),
    message: cleanText(row.message, 500),
    createdAt: Number(row.created_at ?? 0),
    readAt: row.read_at == null ? null : Number(row.read_at),
  };
}

export async function listRunNotifications(env: NotificationEnv, identityValue: string, limit = 50): Promise<{ notifications: PublicRunNotification[]; unread: number }> {
  if (!env.DB) return { notifications: [], unread: 0 };
  await ensureNotificationTables(env);
  const identity = cleanText(identityValue.toLowerCase(), 160) || "portal-user";
  const boundedLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 50, 100));
  const rows = await env.DB.prepare("SELECT n.id, n.run_id, n.status, n.title, n.message, n.created_at, r.read_at FROM operation_notifications n LEFT JOIN operation_notification_reads r ON r.notification_id = n.id AND r.identity = ? ORDER BY n.created_at DESC LIMIT ?")
    .bind(identity, boundedLimit).all<Record<string, unknown>>();
  const count = await env.DB.prepare("SELECT COUNT(*) AS unread FROM operation_notifications n LEFT JOIN operation_notification_reads r ON r.notification_id = n.id AND r.identity = ? WHERE r.notification_id IS NULL")
    .bind(identity).first<Record<string, unknown>>();
  return {
    notifications: (rows.results ?? []).map(publicNotification).filter((item): item is PublicRunNotification => Boolean(item)),
    unread: Math.max(0, Number(count?.unread ?? 0)),
  };
}

export async function markRunNotificationsRead(env: NotificationEnv, identityValue: string, idsValue: string[] | null): Promise<number> {
  if (!env.DB) return 0;
  await ensureNotificationTables(env);
  const identity = cleanText(identityValue.toLowerCase(), 160) || "portal-user";
  let ids = Array.isArray(idsValue) ? Array.from(new Set(idsValue.map((value) => cleanText(value, 160)).filter(Boolean))).slice(0, 100) : [];
  if (!idsValue) {
    const rows = await env.DB.prepare("SELECT id FROM operation_notifications ORDER BY created_at DESC LIMIT 500").all<Record<string, unknown>>();
    ids = (rows.results ?? []).map((row) => cleanText(row.id, 160)).filter(Boolean);
  }
  const readAt = Date.now();
  for (const id of ids) {
    await env.DB.prepare("INSERT INTO operation_notification_reads (notification_id, identity, read_at) SELECT id, ?, ? FROM operation_notifications WHERE id = ? ON CONFLICT(notification_id, identity) DO UPDATE SET read_at = excluded.read_at")
      .bind(identity, readAt, id).run();
  }
  return ids.length;
}
