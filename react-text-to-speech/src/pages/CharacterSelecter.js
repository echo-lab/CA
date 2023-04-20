import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import CharacterCard from "../components/CharacterCard.js";
import "../styles/CharacterSelecter.css";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { booksSummery } from "../Book/BooksSummery";
import { useNavigate } from "react-router-dom";

function CharaterSelecter() {
  const location = useLocation();
  const id = location.state ? location.state.id : null;

  const book = booksSummery.find((book) => book.id === id);
  const [characterValues, setCharacterValues] = useState({});

  // Populate default character values
  useEffect(() => {
    if (book) {
      const defaultValues = book.Characters.reduce((acc, character) => {
        if (character.roles && character.roles.length > 0) {
          acc[character.charater_name] = character.roles[0];
        } else {
          acc[character.charater_name] = "";
        }
        return acc;
      }, {});
      setCharacterValues(defaultValues);
    }
  }, [book]);

  const handleOptionChange = (characterName, value) => {
    setCharacterValues({ ...characterValues, [characterName]: value });
  };

  const navigate = useNavigate();

  const handleNextButtonClick = () => {
    const selectedOptions = Object.keys(characterValues).map((characterName) => ({
      Character: characterName,
      VA: characterValues[characterName],
    }));
    navigate("/story", { state: { selectedOptions } });
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
          <button className="btn btn-primary" onClick={handleNextButtonClick}>
            <i>
              <KeyboardDoubleArrowRightIcon />
            </i>
          </button>
        </div>
      </div>
    </div>
  );
}

export default CharaterSelecter;
