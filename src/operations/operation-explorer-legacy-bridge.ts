export async function resolveLegacyOperationTarget<T>({
  find,
  refresh,
  wait,
}: {
  find: () => T | null;
  refresh: () => void | Promise<void>;
  wait: () => Promise<T | null>;
}): Promise<T | null> {
  const current = find();
  if (current) return current;
  await refresh();
  return wait();
}
