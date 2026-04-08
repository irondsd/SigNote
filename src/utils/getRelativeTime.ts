const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function getRelativeTime(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSeconds = Math.round((then - now) / 1000);
  const absDiff = Math.abs(diffSeconds);

  if (absDiff < 60) return 'seconds ago';
  if (absDiff < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (absDiff < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (absDiff <= 604800) return rtf.format(Math.round(diffSeconds / 86400), 'day');

  return new Date(date).toLocaleDateString();
}
