import React from 'react'
import { Link } from 'react-router-dom'
import Logo from '../Pictures/Mates-07.png'

// participantId/onEndSession/showGoHome are optional: pages that don't run a
// study session render a plain branded bar.
function NavigationBar({ participantId, onEndSession, showGoHome }) {

  return (
        <nav className="navbar navbar-light bg-light d-flex justify-content-between align-items-center">
            <div className="d-flex align-items-center gap-2 ps-3">
              {participantId && (
                <span className="badge bg-secondary" style={{ fontSize: "0.9rem" }}>
                  Participant: {participantId}
                </span>
              )}
              {participantId && onEndSession && (
                <button
                  className="btn btn-sm btn-outline-danger"
                  onClick={onEndSession}
                >End Participant Session</button>
              )}
              {showGoHome && (
                <Link to="/">
                  <button className="btn btn-sm btn-outline-secondary">Go Home</button>
                </Link>
              )}
            </div>

            <a className="navbar-brand pe-3" href="#">
            <img src={Logo} width="300" height="auto" className="d-inline-block align-left" alt=""/>
              JENNIE
            </a>
    </nav>
  );
}

export default NavigationBar
