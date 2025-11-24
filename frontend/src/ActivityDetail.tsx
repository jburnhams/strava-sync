import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Helper to fit bounds
function BoundsHandler({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) {
      map.fitBounds(coords);
    }
  }, [coords, map]);
  return null;
}

export default function ActivityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/activities/${id}`)
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div>Loading...</div>;
  if (!data || data.error) return <div>Activity not found</div>;

  const latlngs = data.streams?.find((s: any) => s.type === "latlng")?.data || [];

  return (
    <div className="container">
      <Link to={`/user/${data.strava_id}`} className="back-link">← Back to User</Link>

      <h1>{data.name}</h1>
      <div className="stats-grid">
         <div className="stat">
            <label>Distance</label>
            <span>{(data.distance / 1000).toFixed(2)} km</span>
         </div>
         <div className="stat">
            <label>Time</label>
            <span>{Math.floor(data.moving_time / 60)} min</span>
         </div>
         <div className="stat">
            <label>Elevation</label>
            <span>{data.total_elevation_gain} m</span>
         </div>
         <div className="stat">
            <label>Date</label>
            <span>{new Date(data.start_date).toLocaleDateString()}</span>
         </div>
      </div>

      {latlngs.length > 0 && (
        <div className="map-container" style={{ height: "400px", marginTop: "20px" }}>
            <MapContainer center={latlngs[0]} zoom={13} style={{ height: "100%", width: "100%" }}>
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <Polyline positions={latlngs} color="blue" />
                <BoundsHandler coords={latlngs} />
            </MapContainer>
        </div>
      )}

      <h2>Raw JSON</h2>
      <pre style={{ background: "#f4f4f4", padding: "10px", overflow: "auto", maxHeight: "500px" }}>
          {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
