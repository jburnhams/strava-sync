import { describe, it, expect } from 'vitest';
import { aggregateActivitiesByMonth, Activity } from '../src/utils';

describe('aggregateActivitiesByMonth', () => {
  it('returns empty array for empty input', () => {
    const result = aggregateActivitiesByMonth([]);
    expect(result).toEqual([]);
  });

  it('aggregates single activity correctly', () => {
    const activities: Activity[] = [
      {
        id: 1,
        strava_id: 123,
        name: 'Run',
        type: 'Run',
        start_date: '2024-01-15T10:00:00Z',
        distance: 5000, // 5km
        moving_time: 1800,
        elapsed_time: 1800,
        total_elevation_gain: 100
      }
    ];

    const result = aggregateActivitiesByMonth(activities);
    expect(result).toHaveLength(1);
    expect(result[0].month).toBe('Jan 2024');
    expect(result[0].distance).toBe(5.00);
  });

  it('sums distances for same month', () => {
    const activities: Activity[] = [
      {
        id: 1,
        strava_id: 123,
        name: 'Run 1',
        type: 'Run',
        start_date: '2024-01-01T10:00:00Z',
        distance: 5000,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      },
      {
        id: 2,
        strava_id: 123,
        name: 'Run 2',
        type: 'Run',
        start_date: '2024-01-15T10:00:00Z',
        distance: 3500,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      }
    ];

    const result = aggregateActivitiesByMonth(activities);
    expect(result).toHaveLength(1);
    expect(result[0].month).toBe('Jan 2024');
    expect(result[0].distance).toBe(8.50);
  });

  it('sorts months chronologically', () => {
    const activities: Activity[] = [
      {
        id: 1, strava_id: 123, name: 'Mar', type: 'Run',
        start_date: '2024-03-01T10:00:00Z', distance: 1000,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      },
      {
        id: 2, strava_id: 123, name: 'Jan', type: 'Run',
        start_date: '2024-01-01T10:00:00Z', distance: 1000,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      },
      {
        id: 3, strava_id: 123, name: 'Feb', type: 'Run',
        start_date: '2024-02-01T10:00:00Z', distance: 1000,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      }
    ];

    const result = aggregateActivitiesByMonth(activities);
    expect(result).toHaveLength(3);
    expect(result[0].month).toBe('Jan 2024');
    expect(result[1].month).toBe('Feb 2024');
    expect(result[2].month).toBe('Mar 2024');
  });

  it('handles cross-year data correctly', () => {
    const activities: Activity[] = [
      {
        id: 1, strava_id: 123, name: 'Dec', type: 'Run',
        start_date: '2023-12-31T10:00:00Z', distance: 1000,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      },
      {
        id: 2, strava_id: 123, name: 'Jan', type: 'Run',
        start_date: '2024-01-01T10:00:00Z', distance: 1000,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      }
    ];

    const result = aggregateActivitiesByMonth(activities);
    expect(result).toHaveLength(2);
    expect(result[0].month).toBe('Dec 2023');
    expect(result[1].month).toBe('Jan 2024');
  });
});
