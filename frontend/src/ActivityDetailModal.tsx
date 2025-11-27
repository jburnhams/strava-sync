import React from 'react';
import Modal from './Modal';
import { Activity, formatDistance, formatDuration, formatSpeed, formatDate } from './utils';

interface ActivityDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  activity: Activity | null;
}

export default function ActivityDetailModal({ isOpen, onClose, activity }: ActivityDetailModalProps) {
  if (!activity) return null;

  // Prefer data_json if available as it has more details, otherwise fallback to top-level
  const details = activity.data_json || {};

  // Helper to render a row safely
  const renderRow = (label: string, value: any, unit: string = '') => {
    if (value === null || value === undefined) return null;
    return (
      <div className="modal-detail-row">
        <span className="modal-detail-label">{label}</span>
        <span className="modal-detail-value">{value}{unit}</span>
      </div>
    );
  };

  const sections = [
    {
      title: "Summary",
      content: (
        <>
          {renderRow("Date", formatDate(activity.start_date))}
          {renderRow("Type", activity.type)}
          {renderRow("Device", details.device_name)}
          {renderRow("Distance", formatDistance(activity.distance))}
          {renderRow("Moving Time", formatDuration(activity.moving_time))}
          {renderRow("Elapsed Time", formatDuration(activity.elapsed_time))}
          {renderRow("Elevation Gain", details.total_elevation_gain || activity.total_elevation_gain, " m")}
        </>
      )
    },
    {
      title: "Performance",
      content: (
        <>
          {renderRow("Avg Speed", formatSpeed(details.average_speed))}
          {renderRow("Max Speed", formatSpeed(details.max_speed))}
          {renderRow("Avg Power", details.average_watts, " W")}
          {renderRow("Max Power", details.max_watts, " W")}
          {renderRow("Weighted Avg Power", details.weighted_average_watts, " W")}
          {renderRow("Energy", details.kilojoules, " kJ")}
        </>
      )
    },
    {
      title: "Physometrics",
      content: (
        <>
          {renderRow("Avg Heart Rate", details.average_heartrate, " bpm")}
          {renderRow("Max Heart Rate", details.max_heartrate, " bpm")}
          {renderRow("Avg Cadence", details.average_cadence, " rpm")}
          {renderRow("Calories", details.calories, " kcal")}
        </>
      )
    },
    {
      title: "Environment",
      content: (
        <>
          {renderRow("Temperature", details.average_temp, " °C")}
          {renderRow("Elevation High", details.elev_high, " m")}
          {renderRow("Elevation Low", details.elev_low, " m")}
        </>
      )
    }
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="activity-detail-modal">
      <h2 className="activity-title">{activity.name}</h2>
      <div className="activity-details-container">
        {sections.map((section, idx) => {
           // Check if section has any visible children (not null)
           // React.Children.toArray allows us to filter nulls if they were direct children,
           // but here 'content' is a Fragment with calls to renderRow which returns null or div.
           // A simple heuristic is: if all data fields in a section are null, the content will be empty divs?
           // renderRow returns null if value is null.
           // So if all renderRow calls return null, the Fragment is empty.
           // However, checking that easily in JS/React without rendering is tricky.
           // We will let it render empty sections if data is completely missing,
           // OR we can move the null check logic up.
           // For now, let's just render. The 'two colours' logic handles empty sections gracefully enough visually, or we can check specific keys.

           return (
             <div key={idx} className="modal-section">
               <h3 className="modal-section-title">{section.title}</h3>
               <div className="modal-section-content">
                 {section.content}
               </div>
             </div>
           );
        })}
      </div>
    </Modal>
  );
}
