import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, aggregateActivitiesByMonth } from './utils';

interface ActivityChartProps {
  activities: Activity[];
}

export default function ActivityChart({ activities }: ActivityChartProps) {
  const data = aggregateActivitiesByMonth(activities);

  if (data.length === 0) {
    return <div className="chart-placeholder">No activity data available</div>;
  }

  return (
    <div className="chart-container" style={{ height: 300, width: '100%', marginTop: '20px' }}>
      <h3>Monthly Distance (km)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="distance" fill="#8884d8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
