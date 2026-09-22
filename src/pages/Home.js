import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom'
import '../styles/Home.css';
import { bookInfo } from "../Book/Books.js"; // assuming that Books.js is in the same directory as Home.js
import NavigationBar from '../components/NavigationBar';
import { clearParticipant, getParticipantId } from '../utils/participant';


function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const { name, userName } = location.state || {};
  const participantId = getParticipantId();
  const participantName = name || userName;

  const renderCard = (card, index) =>{
    const linkTo = "/Character";
    const linkState = { id: card.id, name: participantName };
    return (
        <div className="tw-m-4" key={index}>
          <div className="book-card tw-p-4 tw-mb-12 tw-bg-white tw-rounded-md">
          <div className="tw-relative tw-flex tw-flex-col tw-min-w-0 tw-text-[#212529] tw-break-words tw-bg-white tw-bg-clip-border tw-border tw-border-solid tw-border-[rgba(0,0,0,0.175)] tw-rounded-md" style={{width: "18rem"}}>
            <img className="tw-w-full tw-h-1/2 tw-rounded-t-[0.3125rem]" src={card.img} alt="Card" />
            <div className="tw-flex-auto tw-p-4">
              <h5 className="tw-mb-2">{card.title}</h5>
              <Link to={linkTo} state={linkState}><button className="btn btn-primary">Start Reading</button></Link>
            </div>
          </div>
          </div>
        </div>
    );
  }
  // Without a verified ID every event would log a blank user_id, so send the
  // session back to /Signup rather than let it start untagged.
  if (!participantId) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <h2>No participant ID</h2>
        <p style={{ color: '#666' }}>
          Enter the participant ID provided by the researcher before starting a session.
        </p>
        <Link to="/Signup"><button className="btn btn-primary">Enter Participant ID</button></Link>
      </div>
    );
  }

  return (

    <>
    <div className=''>
      <NavigationBar
        participantId={participantId}
        onEndSession={() => {
          clearParticipant();
          navigate('/Signup');
        }}
        showGoHome
      />
    </div>

    {/* Logs are pulled directly off the VM, not downloaded through the app. */}

    <div className='home'>
      <p className='title tw-text-[calc(1.525rem+3.3vw)] tw-font-light tw-leading-[1.2] [@media(min-width:1200px)]:tw-text-[4rem]'>JENNIE</p>
      <div className= "tw-flex tw-justify-center">
            {bookInfo.map(renderCard)}
      </div>
    </div>
    </>
  )
}

export default Home
