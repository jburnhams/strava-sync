export interface Activity {
  id: number;
  strava_id: number;
  name: string;
  type: string;
  start_date: string;
  distance: number; // meters
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  data_json?: any;
}

export interface MonthlyStats {
  month: string; // "Jan 2024"
  distance: number; // km
  sortKey: string; // "2024-01" for sorting
}

export function aggregateActivitiesByMonth(activities: Activity[]): MonthlyStats[] {
  const grouped = new Map<string, number>();

  for (const act of activities) {
    const date = new Date(act.start_date);
    // Use ISO string for reliable sorting key: YYYY-MM
    const sortKey = date.toISOString().slice(0, 7);

    const currentDistance = grouped.get(sortKey) || 0;
    grouped.set(sortKey, currentDistance + act.distance);
  }

  // Convert to array and sort
  const result: MonthlyStats[] = Array.from(grouped.entries())
    .map(([sortKey, distanceMeters]) => {
      const [year, month] = sortKey.split("-");
      // Create date object to format month name
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      const monthName = date.toLocaleString('default', { month: 'short', year: 'numeric' });

      return {
        month: monthName,
        distance: Number((distanceMeters / 1000).toFixed(2)), // Convert to km and round
        sortKey
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return result;
}

export function formatDuration(seconds: number): string {
  if (!seconds) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatDistance(meters: number): string {
  if (meters === null || meters === undefined) return "";
  return (meters / 1000).toFixed(2) + " km";
}

export function formatSpeed(mps: number): string {
  if (mps === null || mps === undefined) return "";
  return (mps * 3.6).toFixed(1) + " km/h";
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
