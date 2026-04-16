import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { useUser } from "../utils/UserContext";

const CONDITIONS = [
  {
    id: "C1",
    label: "C1",
  },
  {
    id: "C2",
    label: "C2",
  },
  {
    id: "C3",
    label: "C3",
  },
];

export default function ConditionSelecter() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = location.state || {};
  const { userName } = useUser();
  const [selected, setSelected] = useState(null);

  const BASE_URL = process.env.REACT_APP_API_BASE || 'http://localhost:5001';

  const handleNext = () => {
    console.log('[ConditionSelecter] handleNext fired', { selected, userName, id, BASE_URL });
    if (!selected) {
      console.warn('[ConditionSelecter] no condition selected, aborting');
      return;
    }
    console.log('[ConditionSelecter] POST /api/log-session →', `${BASE_URL}/api/log-session`);
    fetch(`${BASE_URL}/api/log-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: userName, book: id, condition: selected }),
    })
      .then(res => res.json().then(data => console.log('[ConditionSelecter] log-session response', res.status, data)))
      .catch(err => console.error('[ConditionSelecter] Failed to log session:', err));
    navigate("/Character", { state: { id, condition: selected } });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", background: "#fff", borderBottom: "1px solid #ddd" }}>
        <button className="btn btn-primary" onClick={() => navigate("/Home")}>
          <KeyboardDoubleArrowLeftIcon fontSize="large" />
        </button>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0 }}>Select Study Condition</h1>
          <p style={{ margin: 0, color: "#666" }}>Choose the reading tracking algorithm for this session.</p>
        </div>
        <button className="btn btn-primary" onClick={handleNext} disabled={!selected}>
          <KeyboardDoubleArrowRightIcon fontSize="large" />
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", padding: "40px 20px" }}>
        {CONDITIONS.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelected(c.id)}
            style={{
              width: "100%",
              maxWidth: "2000px",
              padding: "80px 60px",
              borderRadius: "8px",
              border: `2px solid ${selected === c.id ? "#1976d2" : "#ccc"}`,
              background: selected === c.id ? "#e3f2fd" : "#fff",
              cursor: "pointer",
              boxShadow: selected === c.id ? "0 2px 8px rgba(25,118,210,0.2)" : "0 1px 3px rgba(0,0,0,0.08)",
              transition: "all 0.15s",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "2rem", color: selected === c.id ? "#1976d2" : "#333" }}>{c.label}</h2>
          </div>
        ))}
      </div>
    </div>
  );
}
