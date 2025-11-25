import React, { useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ZAxis } from 'recharts';
import { Activity } from './utils';

interface ActivityScatterPlotProps {
  activities: Activity[];
}

type Metric = 'elapsed_time' | 'distance' | 'total_elevation_gain';

const metricLabels: Record<Metric, string> = {
  'elapsed_time': 'Elapsed Time (hours)',
  'distance': 'Distance (km)',
  'total_elevation_gain': 'Total Ascent (m)',
};

export default function ActivityScatterPlot({ activities }: ActivityScatterPlotProps) {
  const [selectedMetric, setSelectedMetric] = useState<Metric>('elapsed_time');
  const [isFullScreen, setIsFullScreen] = useState(false);

  const data = activities.map(act => {
    let value;
    switch (selectedMetric) {
      case 'distance':
        value = act.distance / 1000;
        break;
      case 'total_elevation_gain':
        value = act.total_elevation_gain;
        break;
      case 'elapsed_time':
      default:
        value = act.elapsed_time / 3600;
        break;
    }
    return {
      date: new Date(act.start_date).getTime(),
      value: value,
      name: act.name,
    };
  });

  if (activities.length === 0) {
    return <div className="chart-placeholder">No activity data to plot</div>;
  }

  const chart = (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart>
        <CartesianGrid />
        <XAxis
          dataKey="date"
          domain={['dataMin', 'dataMax']}
          name="Date"
          tickFormatter={(unixTime) => new Date(unixTime).toLocaleDateString()}
          type="number"
        />
        <YAxis dataKey="value" name={metricLabels[selectedMetric]} label={{ value: metricLabels[selectedMetric], angle: -90, position: 'insideLeft' }} />
        <ZAxis dataKey="name" name="Name" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          formatter={(value: any, name: any, props: any) => [`${props.payload.name}: ${value.toFixed(2)}`, '']}
          labelFormatter={(unixTime: number) => new Date(unixTime).toISOString()}
        />
        <Scatter name="Activities" data={data} fill="#8884d8" />
      </ScatterChart>
    </ResponsiveContainer>
  );

  if (isFullScreen) {
    return (
      <div className="modal">
        <div className="modal-content">
          <button onClick={() => setIsFullScreen(false)}>Close</button>
          {chart}
        </div>
      </div>
    );
  }

  return (
    <div className="chart-container" style={{ height: 300, width: '100%', marginTop: '20px' }}>
      <h3>Activity Plot</h3>
      <select onChange={(e) => setSelectedMetric(e.target.value as Metric)} value={selectedMetric}>
        <option value="elapsed_time">Elapsed Time</option>
        <option value="distance">Distance</option>
        <option value="total_elevation_gain">Total Ascent</option>
      </select>
      <button onClick={() => setIsFullScreen(true)}>Expand</button>
      {chart}
    </div>
  );
}
