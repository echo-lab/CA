import React, { useState } from "react";
import "../styles/CharacterCard.css";
import { booksSummery } from "../Book/BooksSummery";

function CharacterCards({ id }) {
  console.log("CharacterCards", id);
  let result = booksSummery.find((result) => result.id === id);
  console.log("Result:", result.Characters);

  const renderCharacter = (character, index) => {
    const [selectedOption, setSelectedOption] = useState("");

    const handleChange = (event) => {
      setSelectedOption(event.target.value);
      console.log(selectedOption);
    };

    return (
      <div className={`col-md-4 mb-3`} key={index}>
        <div className={`CharacterCards card card-input shadow p-2 mb-5 bg-white rounded`} style={{ width: "18rem", height: "100%" }}>
          <img src={character.img} className="card-img-top" alt="..." />
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-center">
              <p className="card-text mb-0">{character.charater_name}</p>
              <select value={selectedOption} onChange={handleChange} className="form-select form-select-sm">
                <option value="Parent">Parent</option>
                <option value="Child">Child</option>
                <option value="None">None</option>
                <option value="VA1">VA1</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-100">
      <div className="row">
        {result.Characters.map(renderCharacter)}
      </div>
    </div>
  );
}

export default CharacterCards;
