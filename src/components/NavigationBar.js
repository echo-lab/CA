import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../Pictures/Mates-07.png'
import MenuIcon from '@mui/icons-material/Menu'

// participantId/onEndSession/showGoHome are optional: pages that don't run a
// study session render a plain branded bar.
function NavigationBar({ participantId, onEndSession, showGoHome }) {
  // Below 820px the session controls fold into a hamburger dropdown.
  const [menuOpen, setMenuOpen] = useState(false);
  const hasItems = participantId || showGoHome;

  return (
        <nav className="tw-relative tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-py-2 tw-bg-[#f8f9fa]">
            <div className="tw-pl-4">
              {hasItems && (
                <button
                  className="btn btn-outline-secondary min-[820px]:tw-hidden"
                  aria-label="Menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                ><MenuIcon /></button>
              )}
              <div className={`${menuOpen ? 'tw-flex' : 'tw-hidden'} min-[820px]:tw-flex tw-items-center tw-gap-2 max-[819.98px]:tw-absolute max-[819.98px]:tw-top-full max-[819.98px]:tw-left-4 max-[819.98px]:tw-z-10 max-[819.98px]:tw-flex-col max-[819.98px]:tw-items-start max-[819.98px]:tw-gap-3 max-[819.98px]:tw-p-3 max-[819.98px]:tw-bg-white max-[819.98px]:tw-rounded-md max-[819.98px]:tw-shadow-lg`}>
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
            </div>

            <a className="tw-py-[0.3125rem] tw-mr-4 tw-pr-4 tw-text-[1.25rem] tw-text-black tw-no-underline tw-whitespace-nowrap" href="#">
            <img src={Logo} width="300" height="auto" className="tw-inline-block tw-max-w-[40vw]" alt=""/>
              JENNIE
            </a>
    </nav>
  );
}

export default NavigationBar
