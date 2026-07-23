from pathlib import Path

path = Path("scripts/apply-run-notifications-patch.py")
text = path.read_text()
old = '''      const browserSupported = typeof window !== "undefined" && "Notification" in window;
      if (browserSupported) setNotificationPermission(window.Notification.permission);'''
new = '''      const browserSupported = typeof window !== "undefined" && "Notification" in window;
      setNotificationPermission(browserSupported ? window.Notification.permission : "unsupported");'''
if text.count(old) != 1:
    raise RuntimeError("notification support detector not found exactly once")
text = text.replace(old, new, 1)
old_effect = '''  useEffect(() => {
    if (!("Notification" in window)) setNotificationPermission("unsupported");
    const initial = window.setTimeout(() => void loadNotifications(false), 0);'''
new_effect = '''  useEffect(() => {
    const initial = window.setTimeout(() => void loadNotifications(false), 0);'''
if text.count(old_effect) != 1:
    raise RuntimeError("notification effect block not found exactly once")
text = text.replace(old_effect, new_effect, 1)
path.write_text(text)
