export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: Date | string | number | null | undefined): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}

export function formatDue(due: string | Date): string {
  const date = due instanceof Date ? due : new Date(due);
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return 'Due now';

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
