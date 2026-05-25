/** Format a Date as "HH:MM" in local time, zero-padded. */
export function toTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** True iff two dates fall on the same calendar day in local time. */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatRemaining(expiresAt: Date | string): string {
  const target = new Date(expiresAt).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return 'now';
  if (diff < 60_000) {
    const secs = Math.max(1, Math.ceil(diff / 1000));
    return `${secs}s`;
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatExpiry(expiresAt: Date | string): string {
  return new Date(expiresAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
