import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";

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
  const { id, name } = location.state || {};
  const [selected, setSelected] = useState(null);

  const handleNext = () => {
    if (!selected) return;
    navigate("/Character", { state: { id, name, condition: selected } });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", background: "#fff", borderBottom: "1px solid #ddd" }}>
        <button className="btn btn-primary" onClick={() => navigate("/Home", { state: { userName: name } })}>
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
              maxWidth: "560px",
              padding: "20px 24px",
              borderRadius: "8px",
              border: `2px solid ${selected === c.id ? "#1976d2" : "#ccc"}`,
              background: selected === c.id ? "#e3f2fd" : "#fff",
              cursor: "pointer",
              boxShadow: selected === c.id ? "0 2px 8px rgba(25,118,210,0.2)" : "0 1px 3px rgba(0,0,0,0.08)",
              transition: "all 0.15s",
            }}
          >
            <h5 style={{ margin: "0 0 6px", color: selected === c.id ? "#1976d2" : "#333" }}>{c.label}</h5>
          </div>
        ))}
      </div>
    </div>
  );
}
