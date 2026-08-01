/** Formats an ISO timestamp as a short relative age, e.g. "5m", "3h", "2d". */
export function formatTimeAgo(isoTimestamp: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(isoTimestamp).getTime()) / 1000);

  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  return `${Math.floor(days)}d`;
}
