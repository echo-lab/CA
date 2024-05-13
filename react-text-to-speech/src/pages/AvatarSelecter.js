import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom';
import avatar0 from '../Pictures/Avatars/adult0.png';
import avatar1 from '../Pictures/Avatars/adult1.png';
import avatar2 from '../Pictures/Avatars/adult2.png';
import avatar3 from '../Pictures/Avatars/adult3.png';
import avatar4 from '../Pictures/Avatars/adult4.png';
import avatar5 from '../Pictures/Avatars/adult5.png';
import avatar6 from '../Pictures/Avatars/adult6.png';
import avatar7 from '../Pictures/Avatars/adult7.png';
import avatar8 from '../Pictures/Avatars/adult8.png';
import avatar9 from '../Pictures/Avatars/adult9.png';
import avatar10 from '../Pictures/Avatars/adult10.png';
import avatar11 from '../Pictures/Avatars/adult11.png';
import avatar12 from '../Pictures/Avatars/adult12.png';
import avatar13 from '../Pictures/Avatars/adult13.png';
import avatar14 from '../Pictures/Avatars/adult14.png';
import avatar15 from '../Pictures/Avatars/adult15.png';
import avatar16 from '../Pictures/Avatars/adult16.png';
import avatar17 from '../Pictures/Avatars/adult17.png';
import {roles} from "../Book/Roles.js"
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import "../styles/AvatarSelection.css";

function AvatarSelecter() {
    const navigate = useNavigate();
    const [selected, setSelected] = useState(null);
  
    const images = [avatar0, avatar1, avatar2, avatar3, avatar4, avatar5, avatar6, avatar7, avatar8, avatar9, avatar10, avatar11, avatar12, avatar13, avatar14, avatar15, avatar16, avatar17];
  
    const toggleImage = (index) => {
      setSelected(index); 
    };
  
    const handleNextButtonClick = () => {
      if (selected !== null) {
        const parentRole = roles.find(role => role.Role === "Parent");
        console.log(selected)
        parentRole.img = require(`../Pictures/Avatars/adult${selected}.png`)
        console.log(roles)
        navigate('/Signup'); 
      }
    };
  
    return (
      <div className="avatar-container">
        <div className="d-flex flex-column min-vh-100">
        <div className="d-flex justify-content-between p-3 bg-light">
          <div className="align-self-start">
            <div className="sectionTitle display-3">Avatar Selection</div>
            <p>Please select an avatar to represent the parent</p>
          </div>
          <button className="btn btn-primary" onClick={handleNextButtonClick}>
            <KeyboardDoubleArrowRightIcon />
          </button>
        </div>
      <div className="w-80 p-3 d-flex flex-wrap justify-content-center mt-5">
      {images.map((image, index) => (
          <img
            key={index}
            src={image}
            alt={`Image ${index}`}
            className={`avatar-img-thumbnail ${selected === index ? 'selected' : ''}`}
            onClick={() => toggleImage(index)}
          />
        ))}
      </div>
    </div>
    </div>
    );
}

export default AvatarSelecter
