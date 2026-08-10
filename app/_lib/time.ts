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

/**
 * How long until `isoTimestamp`, as a coarse label ("3d left", "5h left").
 *
 * Coarse on purpose: a campaign window runs for days, so a live-ticking
 * countdown would redraw constantly to convey nothing the nearest hour
 * does not. Returns "Ended" once the moment has passed rather than a
 * negative duration.
 */
export function formatTimeLeft(isoTimestamp: string): string {
  const ms = new Date(isoTimestamp).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "-";
  if (ms <= 0) return "Ended";

  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) return `${days}d left`;
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, minutes)}m left`;
}
