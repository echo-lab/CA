import React from 'react';
import { Link } from 'react-router-dom'
import '../styles/Home.css';
import { bookInfo } from "../Book/Books.js"; // assuming that Books.js is in the same directory as Home.js
import NavigationBar from '../components/NavigationBar';






function Home() {

  const renderCard = (card, index) =>{
    return (
        <div className="m-3" key={index}>
          <div className="shadow p-3 mb-5 bg-white rounded">
          <div className="card" style={{width: "18rem"}}>
            <img className="card-img-top h-50" src={card.img} alt="Card" />
            <div className="card-body">
              <h5 className="card-title">{card.title}</h5>
              <Link to="/Story" state={{id: card.id}}><button className="btn btn-primary">Start Reading</button></Link> 
            </div>
          </div>
          </div>
        </div>
    );
  }
  return (
    
    <>
    <div className=''> <NavigationBar /></div>
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