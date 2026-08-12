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
        <div className="m-3" key={index}>
          <div className="shadow p-3 mb-5 bg-white rounded">
          <div className="card" style={{width: "18rem"}}>
            <img className="card-img-top h-50" src={card.img} alt="Card" />
            <div className="card-body">
              <h5 className="card-title">{card.title}</h5>
              <div style={{ display: "flex", gap: "8px" }}>
                <Link to={linkTo} state={linkState}><button className="btn btn-primary">Start Reading</button></Link>
              </div>
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
      <p className='title display-3'>JENNIE</p>
      <div className= "d-flex justify-content-center">
            {bookInfo.map(renderCard)}
      </div>
    </div>
    </>
  )
}

export default Home
