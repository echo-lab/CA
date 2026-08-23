import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom'
import '../styles/Home.css';
import { bookInfo } from "../Book/Books.js"; // assuming that Books.js is in the same directory as Home.js
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
import NavigationBar from '../components/NavigationBar';
import { clearParticipant, getParticipantId } from '../utils/participant';
import { tagBook } from '../utils/imageAnalysis';

const bookPages = {
  1: data1[0].Book.Pages,
  2: data2[0].Book.Pages,
  3: data3[0].Book.Pages,
};


function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const { name, userName } = location.state || {};
  const participantId = getParticipantId();
  const participantName = name || userName;

  // { [bookId]: { done, total, finished } } — one entry per book being tagged.
  const [tagStatus, setTagStatus] = useState({});

  const handleTag = async (id) => {
    const pages = bookPages[id];
    if (!pages) return;
    const total = Object.keys(pages).length - 1;
    setTagStatus((s) => ({ ...s, [id]: { done: 0, total } }));
    await tagBook(id, pages, (done, t) => {
      setTagStatus((s) => ({ ...s, [id]: { done, total: t } }));
    });
    setTagStatus((s) => ({ ...s, [id]: { ...s[id], finished: true } }));
  };

  const renderCard = (card, index) =>{
    const linkTo = "/Character";
    const linkState = { id: card.id, name: participantName };
    const status = tagStatus[card.id];
    const tagging = status && !status.finished;
    const tagLabel = tagging
      ? `Tagging ${status.done}/${status.total}\u2026`
      : status?.finished
        ? `Tagged ${status.total}`
        : 'Tag Images';
    return (
        <div className="m-3" key={index}>
          <div className="shadow p-3 mb-5 bg-white rounded">
          <div className="card" style={{width: "18rem"}}>
            <img className="card-img-top h-50" src={card.img} alt="Card" />
            <div className="card-body">
              <h5 className="card-title">{card.title}</h5>
              <div style={{ display: "flex", gap: "8px" }}>
                <Link to={linkTo} state={linkState}><button className="btn btn-primary">Start Reading</button></Link>
                <button
                  className="btn btn-outline-secondary"
                  onClick={() => handleTag(card.id)}
                  disabled={tagging}
                  title="Re-run image tagging for every page of this book"
                >
                  {tagLabel}
                </button>
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
