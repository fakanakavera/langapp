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

export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}
