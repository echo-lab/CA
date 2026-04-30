import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";

const RATING_SCALE = [
  { value: 1, label: "Never" },
  { value: 2, label: "A little bit of the time" },
  { value: 3, label: "Sometimes" },
  { value: 4, label: "Very often" },
  { value: 5, label: "All of the time" },
];

const QUESTION_TEMPLATES = [
  "I need assistance from another person using {C}.",
  "{C} demands too much mental effort.",
  "It takes too long for me to do what I want to do with {C}.",
  "{C} is hard to learn.",
  "Use of {C} is too physically demanding.",
  "{C} distracts me from interacting with my child.",
  "Using {C} has a negative effect on interaction with my child.",
  "{C} requires me to remember too much information.",
  "{C} presents too much information at once.",
];

export default function Survey() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id, name, condition } = location.state || {};
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const BASE_URL = process.env.REACT_APP_API_BASE || "http://localhost:5001";

  const hasSession = Boolean(condition);

  const questions = QUESTION_TEMPLATES.map((q) =>
    q.replace(/\{C\}/g, condition || "C?")
  );

  const allAnswered = hasSession && questions.every((_, i) => answers[i]);

  const handleSubmit = () => {
    console.log('[Survey] handleSubmit fired', { allAnswered, name, id, condition, answers, BASE_URL });
    if (!allAnswered) {
      console.warn('[Survey] not all answered, aborting');
      return;
    }
    console.log('[Survey] POST /api/log-survey →', `${BASE_URL}/api/log-survey`);
    fetch(`${BASE_URL}/api/log-survey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, book: id, condition, answers }),
    })
      .then(res => res.json().then(data => console.log('[Survey] log-survey response', res.status, data)))
      .catch((err) => console.error("[Survey] Failed to log survey:", err));
    setSubmitted(true);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", background: "#fff", borderBottom: "1px solid #ddd" }}>
        <button className="btn btn-primary" onClick={() => navigate("/Home")}>
          <KeyboardDoubleArrowLeftIcon fontSize="large" />
        </button>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0 }}>User Experience Survey</h1>
          <p style={{ margin: 0, color: "#666" }}>Rate your experience with the reading condition.</p>
        </div>
        <div style={{ width: 70 }} />
      </div>

      <div style={{ flex: 1, padding: "24px", maxWidth: "1000px", margin: "0 auto", width: "100%" }}>
        {submitted ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <h2>Thank you!</h2>
            <p style={{ color: "#666" }}>Your responses have been recorded.</p>
            <button className="btn btn-primary" onClick={() => navigate("/Home")}>
              Back to Home
            </button>
          </div>
        ) : !hasSession ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <h2>No session found</h2>
            <p style={{ color: "#666" }}>The survey requires a completed reading session. Please start from Home.</p>
            <button className="btn btn-primary" onClick={() => navigate("/Home")}>
              Back to Home
            </button>
          </div>
        ) : (
          <>
            <div style={{ background: "#fff", padding: "16px 20px", borderRadius: "8px", marginBottom: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <span style={{ fontWeight: 600, marginRight: "8px" }}>Rating condition:</span>
              <span>{condition}</span>
            </div>

            {questions.map((q, i) => (
              <div key={i} style={{ background: "#fff", padding: "16px 20px", borderRadius: "8px", marginBottom: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <p style={{ margin: "0 0 12px", fontWeight: 500 }}>
                  {i + 1}. {q}
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {RATING_SCALE.map((r) => (
                    <label
                      key={r.value}
                      style={{
                        flex: "1 1 160px",
                        padding: "8px 12px",
                        border: `2px solid ${answers[i] === r.value ? "#1976d2" : "#ccc"}`,
                        borderRadius: "6px",
                        background: answers[i] === r.value ? "#e3f2fd" : "#fff",
                        cursor: "pointer",
                        textAlign: "center",
                      }}
                    >
                      <input
                        type="radio"
                        name={`q${i}`}
                        value={r.value}
                        checked={answers[i] === r.value}
                        onChange={() => setAnswers((prev) => ({ ...prev, [i]: r.value }))}
                        style={{ marginRight: "6px" }}
                      />
                      {r.value} — {r.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ textAlign: "center", marginTop: "24px" }}>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!allAnswered}
                style={{ padding: "10px 40px", fontSize: "1.1rem" }}
              >
                Submit
              </button>
              {!allAnswered && (
                <p style={{ color: "#888", marginTop: "8px", fontSize: "0.9rem" }}>
                  Please answer all questions.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
