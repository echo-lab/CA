import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import CharacterCard from "../components/CharacterCard.js";
import "../styles/CharacterSelecter.css";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { booksSummery } from "../Book/BooksSummery";

function CharaterSelecter() {
  const location = useLocation();
  const id = location.state ? location.state.id : null;
  console.log("CharaterSelecter:", id);

  const book = booksSummery.find((book) => book.id === id);
  const [characterValues, setCharacterValues] = useState({});

  const handleOptionChange = (characterName, value) => {
    setCharacterValues({ ...characterValues, [characterName]: value });
  };

  return (
    <div>
      <div className="row">
        <div className="rightbutton col-1">
          <Link to="/">
            <button className="btn btn-primary">
              <i>
                <KeyboardDoubleArrowLeftIcon />
              </i>
            </button>
          </Link>
        </div>
        <div className="col-8">
          <div className="sectionTitle display-3 m-5">Select Character's Role</div>
          <div className="row">
            {book &&
              book.Characters.map((character, index) => (
                <div key={index} className="col-md-4">
                  <CharacterCard
                    character={character}
                    onOptionChange={(value) => handleOptionChange(character.charater_name, value)}
                  />
                </div>
              ))}
          </div>
        </div>
        <div className="leftbutton col-1">
          <Link to="/story">
            <button className="btn btn-primary">
              <i>
                <KeyboardDoubleArrowRightIcon />
              </i>
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default CharaterSelecter;
