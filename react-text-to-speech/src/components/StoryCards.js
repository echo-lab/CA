import React from "react";
import { Link } from 'react-router-dom'
import '../styles/StoryCards.css'
import pinnochio from "../Pictures/pinnochio.png";
import snowWhite from "../Pictures/snowWhite.jpg";
import peterpan from "../Pictures/tangled.jpg";


const cardInfo = [
  {id:1, title:"Pinnochio", image: pinnochio},
  {id:2, title:"Snow White", image: snowWhite},
  {id:3, title:"Tangled", image: peterpan},
];


const renderCard = (card, index) =>{
  return (
      <div className="m-3" key={index}>
        <div className="shadow p-3 mb-5 bg-white rounded">
        <div className="card" style={{width: "18rem"}}>
          <img className="card-img-top h-50" src={card.image} alt="Card image" />
          <div className="card-body">
            <h5 className="card-title">{card.title}</h5>
            <Link to="/story"><button className="btn btn-primary">Start Reading</button></Link> 
          </div>
        </div>
        </div>
      </div>
  );
}




function StoryCards() {
   return(
    <div className="storyCards">
      <div className= "d-flex justify-content-center">
            {cardInfo.map(renderCard)}
      </div>   
    </div>
   );
}

export default StoryCards;
