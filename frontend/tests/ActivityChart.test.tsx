import React from 'react';
import { render, screen } from '@testing-library/react';
import ActivityChart from '../src/ActivityChart';
import { Activity } from '../src/utils';
import { describe, it, expect, vi } from 'vitest';

// Mock Recharts to avoid ResizeObserver and layout issues in JSDOM
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div className="recharts-responsive-container">
        {React.cloneElement(children, { width: 500, height: 300 })}
      </div>
    ),
  };
});

describe('ActivityChart', () => {
  it('renders "No activity data available" when list is empty', () => {
    render(<ActivityChart activities={[]} />);
    expect(screen.getByText('No activity data available')).toBeInTheDocument();
  });

  it('renders chart title when activities exist', () => {
    const activities: Activity[] = [
      {
        id: 1, strava_id: 123, name: 'Run', type: 'Run',
        start_date: '2024-01-01T10:00:00Z', distance: 5000,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      }
    ];

    render(<ActivityChart activities={activities} />);
    expect(screen.getByText('Monthly Distance (km)')).toBeInTheDocument();
  });

  it('renders axis labels based on data', async () => {
     const activities: Activity[] = [
      {
        id: 1, strava_id: 123, name: 'Run', type: 'Run',
        start_date: '2024-01-01T10:00:00Z', distance: 5000,
        moving_time: 0, elapsed_time: 0, total_elevation_gain: 0
      }
    ];

    render(<ActivityChart activities={activities} />);

    // With width/height mocked, Recharts should be able to render the axis text
    const monthLabel = await screen.findByText('Jan 2024');
    expect(monthLabel).toBeInTheDocument();
  });
});
