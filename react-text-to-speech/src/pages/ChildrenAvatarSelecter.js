import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import avatar0 from '../Pictures/Avatars/child0.png';
import avatar1 from '../Pictures/Avatars/child1.png';
import avatar2 from '../Pictures/Avatars/child2.png';
import avatar3 from '../Pictures/Avatars/child3.png';
import avatar4 from '../Pictures/Avatars/child4.png';
import avatar5 from '../Pictures/Avatars/child5.png';
import avatar6 from '../Pictures/Avatars/child6.png';
import avatar7 from '../Pictures/Avatars/child7.png';
import avatar8 from '../Pictures/Avatars/child8.png';
import avatar9 from '../Pictures/Avatars/child9.png';
import avatar10 from '../Pictures/Avatars/child10.png';
import avatar11 from '../Pictures/Avatars/child11.png';
import avatar12 from '../Pictures/Avatars/child12.png';
import avatar13 from '../Pictures/Avatars/child13.png';
import avatar14 from '../Pictures/Avatars/child14.png';
import avatar15 from '../Pictures/Avatars/child15.png';
import avatar16 from '../Pictures/Avatars/child16.png';
import avatar17 from '../Pictures/Avatars/child17.png';
import avatar18 from '../Pictures/Avatars/child18.png';
import avatar19 from '../Pictures/Avatars/child19.png';
import avatar20 from '../Pictures/Avatars/child20.png';
import avatar21 from '../Pictures/Avatars/child21.png';
import avatar22 from '../Pictures/Avatars/child22.png';
import avatar23 from '../Pictures/Avatars/child23.png';
import {roles} from "../Book/Roles.js"
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import "../styles/AvatarSelection.css";

function ChildrenAvatarSelecter() {
    const navigate = useNavigate();
    const [selected, setSelected] = useState(null);
    const { userName } = useLocation().state || {};

  
    const images = [avatar0, avatar1, avatar2, avatar3, avatar4, avatar5, avatar6, avatar7, avatar8, avatar9, avatar10, avatar11, avatar12, avatar13, avatar14, avatar15, avatar16, avatar17, avatar18, avatar19, avatar20, avatar21, avatar22, avatar23];
  
    const toggleImage = (index) => {
      setSelected(index); 
    };
  
    const handleNextButtonClick = () => {
      if (selected !== null) {
        const childRole = roles.find(role => role.Role === "Child");
        console.log(selected)
        childRole.img = require(`../Pictures/Avatars/child${selected}.png`)
        console.log(roles)
        navigate('/AvatarSelecter', { state: { userName } }); 
      }
    };
  
    return (
      <div className="avatar-container">
        <div className="d-flex flex-column min-vh-100">
          <div className="d-flex justify-content-between p-3 bg-light">
            <div className="align-self-start">
              <div className="sectionTitle display-3">Children Avatar Selection</div>
              <p>Please select an avatar to represent the child</p>
            </div>
            <button className="btn btn-primary next-btn" onClick={handleNextButtonClick}>
              <KeyboardDoubleArrowRightIcon style={{ fontSize: "2rem" }}/>
            </button>
          </div>
          <div className="w-80 p-3 d-flex flex-wrap justify-content-center align-items-center mt-5">
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

export default ChildrenAvatarSelecter;