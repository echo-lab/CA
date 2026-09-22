import React from 'react'
import { Link } from 'react-router-dom'
import Logo from '../Pictures/Mates-07.png'

// participantId/onEndSession/showGoHome are optional: pages that don't run a
// study session render a plain branded bar.
function NavigationBar({ participantId, onEndSession, showGoHome }) {

  return (
        <nav className="tw-relative tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-py-2 tw-bg-[#f8f9fa]">
            <div className="tw-flex tw-items-center tw-gap-2 tw-pl-4">
              {participantId && (
                <span className="tw-inline-block tw-px-[0.65em] tw-py-[0.35em] tw-font-bold tw-leading-none tw-text-white tw-text-center tw-whitespace-nowrap tw-align-baseline tw-rounded-md tw-bg-[#6c757d]" style={{ fontSize: "0.9rem" }}>
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

            <a className="tw-py-[0.3125rem] tw-mr-4 tw-pr-4 tw-text-[1.25rem] tw-text-black tw-no-underline tw-whitespace-nowrap" href="#">
            <img src={Logo} width="300" height="auto" className="tw-inline-block" alt=""/>
              JENNIE
            </a>
    </nav>
  );
}

export default NavigationBar
