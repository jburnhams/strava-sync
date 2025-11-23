import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface User {
  strava_id: number;
  firstname: string;
  lastname: string;
  profile_pic: string;
  last_synced_at: number | null;
}

export default function Dashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/users")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load users");
        return res.json();
      })
      .then((data) => {
        setUsers(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const handleConnect = async () => {
    // Check if configured first
    try {
       // We can just try to login, if 500 then config needed
       const res = await fetch("/api/auth/login", { redirect: "manual" });
       if (res.type === "opaqueredirect" || res.status === 302 || res.status === 200) { // 302 manual redirect
          window.location.href = "/api/auth/login";
       } else if (res.status === 500) {
          // Likely not configured
          navigate("/setup");
       }
    } catch {
       navigate("/setup");
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="container">
      <h1>Strava Sync</h1>

      <div className="user-list">
        {users.length === 0 ? (
          <p>No users connected yet.</p>
        ) : (
          users.map((user) => (
            <Link key={user.strava_id} to={`/user/${user.strava_id}`} className="user-card">
              <img src={user.profile_pic || "https://via.placeholder.com/100"} alt="Profile" />
              <div>
                <h3>{user.firstname} {user.lastname}</h3>
                <p>Last Synced: {user.last_synced_at ? new Date(user.last_synced_at * 1000).toLocaleString() : "Never"}</p>
              </div>
            </Link>
          ))
        )}
      </div>

      <button onClick={handleConnect} className="btn-primary">Connect New Strava User</button>
    </div>
  );
}
