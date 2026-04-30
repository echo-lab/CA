import React from 'react';
import { Link, useLocation } from 'react-router-dom'
import '../styles/Home.css';
import { bookInfo } from "../Book/Books.js"; // assuming that Books.js is in the same directory as Home.js
import NavigationBar from '../components/NavigationBar';


function Home() {
  const location = useLocation();
  const { name } = location.state || {};

  const renderCard = (card, index) =>{
    // Book 3 ("Levels in the Library") is the training book — skip condition select & survey.
    const isTraining = card.id === 3;
    const linkTo = isTraining ? "/Character" : "/ConditionSelect";
    const linkState = isTraining
      ? { id: card.id, name, condition: null, training: true }
      : { id: card.id, name };
    return (
        <div className="m-3" key={index}>
          <div className="shadow p-3 mb-5 bg-white rounded">
          <div className="card" style={{width: "18rem"}}>
            <img className="card-img-top h-50" src={card.img} alt="Card" />
            <div className="card-body">
              <h5 className="card-title">{card.title}</h5>
              <Link to={linkTo} state={linkState}><button className="btn btn-primary">Start Reading</button></Link>
            </div>
          </div>
          </div>
        </div>
    );
  }
  return (
    
    <>
    <div className=''> <NavigationBar />
    </div>

    <div className="go-home-button p-3" style={{ display: "flex", gap: "10px" }}>
  <Link to="/">
    <button className="btn btn-outline-secondary">Go Home</button>
  </Link>
  <button
    className="btn btn-outline-secondary"
    onClick={() => {
      const BASE_URL = process.env.REACT_APP_API_BASE || 'http://localhost:5001';
      window.open(`${BASE_URL}/api/log-session/download`, '_blank');
    }}
  >Download Session Log</button>
  <button
    className="btn btn-outline-secondary"
    onClick={() => {
      const BASE_URL = process.env.REACT_APP_API_BASE || 'http://localhost:5001';
      window.open(`${BASE_URL}/api/log-events/download`, '_blank');
    }}
  >Download Event Logs</button>
</div>
    
    <div className='home'>
      <p className='title display-3'>TaleMate</p>
      <div className= "d-flex justify-content-center">
            {bookInfo.map(renderCard)}
      </div>
    </div>
    </>
  )
}

export default Home