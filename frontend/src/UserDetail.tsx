import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ActivityChart from "./ActivityChart";
import ActivityScatterPlot from "./ActivityScatterPlot.tsx";
import ActivityDetailModal from "./ActivityDetailModal";
import { Activity } from "./utils";

export default function UserDetail() {
  const { id } = useParams();
  const [user, setUser] = useState<any>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  const fetchUser = async () => {
    const res = await fetch(`/api/users/${id}`);
    if (res.ok) setUser(await res.json());
  };

  const fetchActivities = async () => {
    const res = await fetch(`/api/users/${id}/activities`);
    if (res.ok) setActivities(await res.json());
  };

  useEffect(() => {
    fetchUser();
    fetchActivities();
  }, [id]);

  if (!user) return <div>Loading...</div>;

  return (
    <div className="container">
      <Link to="/" className="back-link">← Back to Dashboard</Link>

      <div className="profile-header">
        <img src={user.profile_pic || "https://via.placeholder.com/150"} alt="Profile" className="profile-pic-large" />
        <div>
           <h1>{user.firstname} {user.lastname}</h1>
           <p>ID: {user.strava_id}</p>
           <p>Last synced: {user.last_synced_at ? new Date(user.last_synced_at * 1000).toLocaleString() : "Never"}</p>
        </div>
      </div>

      <ActivityChart activities={activities} />
      <ActivityScatterPlot activities={activities} onActivityClick={setSelectedActivity} />

      <h2>Activities ({activities.length})</h2>
      <div className="activity-list">
        {activities.map(act => (
          <div key={act.id} className="activity-item" onClick={() => setSelectedActivity(act)}>
             <strong>{act.name}</strong>
             <span>{act.type}</span>
             <span>{(act.distance / 1000).toFixed(2)} km</span>
             <span>{new Date(act.start_date).toLocaleDateString()}</span>
          </div>
        ))}
      </div>

      <ActivityDetailModal
        isOpen={!!selectedActivity}
        onClose={() => setSelectedActivity(null)}
        activity={selectedActivity}
      />
    </div>
  );
}
