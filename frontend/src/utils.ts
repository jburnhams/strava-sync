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
  data_json?: string;
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
