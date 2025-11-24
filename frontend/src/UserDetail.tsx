import React, { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";

export default function UserDetail() {
  const { id } = useParams();
  const [user, setUser] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const [syncSince, setSyncSince] = useState("");
  const abortController = useRef<AbortController | null>(null);

  const fetchUser = async () => {
    const res = await fetch(`/api/users/${id}`);
    if (res.ok) {
        const u = await res.json();
        setUser(u);
        setSyncSince(u.sync_since || "2018-01-01");
    }
  };

  const fetchActivities = async () => {
    const res = await fetch(`/api/users/${id}/activities`);
    if (res.ok) setActivities(await res.json());
  };

  useEffect(() => {
    fetchUser();
    fetchActivities();
  }, [id]);

  const handleConfigUpdate = async () => {
      await fetch(`/api/users/${id}/config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sync_since: syncSince })
      });
      alert("Settings saved!");
  };

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

  const handleSyncStreams = async () => {
    setSyncing(true);
    setProgress("Syncing streams...");
    abortController.current = new AbortController();

    let complete = false;
    let totalSynced = 0;

    try {
        while(!complete) {
            if (abortController.current.signal.aborted) break;

            setProgress(`Fetching GPS streams... (Total: ${totalSynced})`);

            // Fetch in batches of 5
            const res = await fetch(`/api/users/${id}/streams?limit=5`, {
                method: "POST",
                signal: abortController.current.signal
            });

            if (!res.ok) {
                if (res.status === 429) setProgress("Rate Limited. Try again later.");
                else setProgress(`Error: ${res.statusText}`);
                break;
            }

            const data = await res.json();
            totalSynced += data.synced;

            if (data.complete) complete = true;
            if (data.synced === 0 && !data.complete) {
                // Should not happen unless logic bug or weird state
                break;
            }

            // Small delay to be nice to API?
            await new Promise(r => setTimeout(r, 1000));
        }
        if (complete) setProgress(`Stream Sync Complete! Fetched ${totalSynced} streams.`);
    } catch (e: any) {
        if (e.name !== "AbortError") setProgress("Stream Sync failed.");
    } finally {
        setSyncing(false);
    }
  };

  const handleDeleteAll = async () => {
      if (!confirm("Are you sure you want to delete ALL activities and streams? This cannot be undone.")) return;

      const res = await fetch(`/api/users/${id}/activities`, { method: "DELETE" });
      if (res.ok) {
          setActivities([]);
          fetchUser();
          alert("All activities deleted.");
      }
  };

  const handleDeleteActivity = async (actId: number) => {
      if (!confirm("Delete this activity?")) return;
      const res = await fetch(`/api/activities/${actId}`, { method: "DELETE" });
      if (res.ok) {
          setActivities(activities.filter(a => a.id !== actId));
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
        <div className="actions">
           <div className="config-box">
               <label>Sync Since:</label>
               <input type="date" value={syncSince} onChange={e => setSyncSince(e.target.value)} />
               <button onClick={handleConfigUpdate} disabled={syncing}>Save Prefs</button>
           </div>

           <div className="sync-buttons">
                <button onClick={handleSync} disabled={syncing} className="btn-primary">
                {syncing ? "Syncing..." : "Sync Activities"}
                </button>
                <button onClick={handleSyncStreams} disabled={syncing} className="btn-secondary">
                Sync Streams (GPS)
                </button>
                <button onClick={handleDeleteAll} disabled={syncing} className="btn-danger">
                Delete All
                </button>
           </div>
        </div>
      </div>

      {progress && <div className="sync-status">{progress}</div>}

      <h2>Activities ({activities.length})</h2>
      <div className="activity-list">
        {activities.map(act => (
          <div key={act.id} className="activity-item">
             <div className="info">
                <strong><Link to={`/activities/${act.id}`}>{act.name}</Link></strong>
                <span>{act.type}</span>
                <span>{(act.distance / 1000).toFixed(2)} km</span>
                <span>{new Date(act.start_date).toLocaleDateString()}</span>
             </div>
             <button onClick={() => handleDeleteActivity(act.id)} className="btn-small-danger">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
