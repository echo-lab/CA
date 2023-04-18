import React from "react";
import "../styles/CharacterCard.css";

function CharacterCard({ character, onOptionChange }) {
  const options = [
    "Parent",
    "Child",
    "Mate 1",
    "Mate 2",
    "Mate 3",
    "Mate 4",
    "Mate 5",
    "Mate 6",
    "None",
  ];

  const handleChange = (event) => {
    onOptionChange(event.target.value);
  };

  return (
    <div className="character-card">
      <div className="card">
        <div className="card-img-container">
          <img
            src={character.img}
            className="card-img-top"
            alt={character.charater_name}
          />
        </div>
        <div className="card-body">
          <h5 className="card-title">{character.charater_name}</h5>
          <div className="mb-3">
            <label htmlFor="exampleFormControlSelect1">Role</label>
            <select
              className="form-control"
              id="exampleFormControlSelect1"
              onChange={handleChange}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CharacterCard;
