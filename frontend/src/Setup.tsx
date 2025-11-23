import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Setup() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });

    if (res.ok) {
      alert("Configuration Saved!");
      navigate("/");
    } else {
      alert("Failed to save configuration");
    }
  };

  return (
    <div className="container">
      <h1>App Setup</h1>
      <p>Please enter your Strava API Credentials.</p>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="client-id">Client ID</label>
          <input
            id="client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="client-secret">Client Secret</label>
          <input
            id="client-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn-primary">Save & Continue</button>
      </form>
    </div>
  );
}
