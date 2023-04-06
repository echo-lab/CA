import React from "react";
import { useState } from "react";
import "../styles/CharacterCard.css";
import { booksSummery } from "../Book/BooksSummery";

const renderCharacter = (character, index) => {
  const [checked, setchecked] = useState(false);

  const handleChange = (event) => {
    setchecked(event.target.checked);
    console.log(checked);
  };

  return (
   <div className="m-2" key={index}>
      <div className="CharacterCards">
         <label className=" card card-input shadow p-2 mb-5 bg-white rounded" style={{ width: "9rem" }}>
            <input type="checkbox" name="checked" className="card-input-element" onChange={handleChange}/>
            <img src={character.img} className="card-img-top" alt="..." />
            <div className="card-body">
               <p className="card-text">{character.charater_name}</p>
            </div>
         </label>
      </div>
 </div>
  );
};

function CharacterCards({ id }) {
  console.log("CharacterCards", id);
  let result = booksSummery.find((result) => result.id === id);
  console.log("Result:", result.Characters);
  return (
    <div className="w-75 d-flex flex-wrap justify-content-center">
      {result.Characters.map(renderCharacter)}
    </div>
  );
}

export default CharacterCards;
