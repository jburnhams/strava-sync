import React, { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";

export default function UserDetail() {
  const { id } = useParams();
  const [user, setUser] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const abortController = useRef<AbortController | null>(null);

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

  const handleSync = async () => {
    setSyncing(true);
    setProgress("Starting sync...");
    abortController.current = new AbortController();

    let page = 1;
    let complete = false;
    let totalSynced = 0;

    try {
      while (!complete) {
        if (abortController.current.signal.aborted) break;

        setProgress(`Syncing page ${page}... (Total: ${totalSynced})`);

        const res = await fetch(`/api/users/${id}/sync?page=${page}`, {
          method: "POST",
          signal: abortController.current.signal
        });

        if (!res.ok) {
           setProgress(`Error: ${res.statusText}`);
           break;
        }

        const data = await res.json();
        totalSynced += data.synced;

        if (data.complete) {
          complete = true;
        } else {
          page = data.next_page;
        }
      }

      if (complete) {
        setProgress(`Sync Complete! Fetched ${totalSynced} activities.`);
        fetchUser(); // Refresh last synced time
        fetchActivities(); // Refresh list
      }
    } catch (e: any) {
       if (e.name !== "AbortError") {
         setProgress("Sync failed.");
       }
    } finally {
      setSyncing(false);
    }
  };

  if (!user) return <div>Loading...</div>;

  return (
    <div className="container">
      <Link to="/" className="back-link">← Back to Dashboard</Link>

      <div className="profile-header">
        <img src={user.profile_pic} alt="Profile" className="profile-pic-large" />
        <div>
           <h1>{user.firstname} {user.lastname}</h1>
           <p>ID: {user.strava_id}</p>
        </div>
        <button onClick={handleSync} disabled={syncing} className="btn-primary">
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {progress && <div className="sync-status">{progress}</div>}

      <h2>Activities ({activities.length})</h2>
      <div className="activity-list">
        {activities.map(act => (
          <div key={act.id} className="activity-item">
             <strong>{act.name}</strong>
             <span>{act.type}</span>
             <span>{(act.distance / 1000).toFixed(2)} km</span>
             <span>{new Date(act.start_date).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
