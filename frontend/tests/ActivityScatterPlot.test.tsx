import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ActivityScatterPlot from '../src/ActivityScatterPlot';
import { Activity } from '../src/utils';

// Mock ResponsiveContainer to pass fixed dimensions to the chart, resolving rendering issues in JSDOM
vi.mock('recharts', async (importOriginal) => {
    const originalModule = await importOriginal();
    return {
        ...originalModule,
        ResponsiveContainer: ({ children }) => {
            const chart = React.Children.only(children);
            return React.cloneElement(chart, { width: 500, height: 500 });
        },
    };
});

const mockActivities: Activity[] = [
  { id: 1, strava_id: 1, name: 'Morning Run', type: 'Run', start_date: '2024-01-01T08:00:00Z', distance: 5000, moving_time: 1800, elapsed_time: 1800, total_elevation_gain: 50 },
  { id: 2, strava_id: 2, name: 'Afternoon Ride', type: 'Ride', start_date: '2024-01-02T14:00:00Z', distance: 20000, moving_time: 3600, elapsed_time: 3600, total_elevation_gain: 200 },
];

describe('ActivityScatterPlot', () => {
  it('renders the chart with a dropdown', () => {
    render(<ActivityScatterPlot activities={mockActivities} />);
    expect(screen.getByText('Activity Plot')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('changes the displayed data when the dropdown is used', () => {
    render(<ActivityScatterPlot activities={mockActivities} />);

    // Default is Elapsed Time
    expect(screen.getByText('Elapsed Time (hours)')).toBeInTheDocument();

    // Change to Distance
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'distance' } });
    expect(screen.getByText('Distance (km)')).toBeInTheDocument();

    // Change to Total Ascent
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'total_elevation_gain' } });
    expect(screen.getByText('Total Ascent (m)')).toBeInTheDocument();
  });

  it('shows a placeholder when there is no data', () => {
    render(<ActivityScatterPlot activities={[]} />);
    expect(screen.getByText('No activity data to plot')).toBeInTheDocument();
  });
});
