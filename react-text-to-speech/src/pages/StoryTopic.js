import React from 'react';
import { Link } from 'react-router-dom';
import { useLocation, useNavigate } from "react-router-dom";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import { data as data1 } from "../Book/Book1";
import { data as data2 } from "../Book/Book2";
import { data as data3 } from "../Book/Book3";
import "../styles/storyTopic.css";



function StoryTopic() {

  const navigate = useNavigate();
  const location = useLocation();
  const selectedOptions = location.state ? location.state.selectedOptions : {};
  const id = location.state ? location.state.id : {};
  console.log(id)
  console.log("selectedOptions:",selectedOptions)

  let bookData
  switch (id) {
    case 1:
      bookData = data1;
      break;
    case 2:
      bookData = data2;
      break;
    case 3:
      bookData = data3;
      break;
    default:
      throw new Error("Invalid book id");
  }
  console.log("Book Data",bookData[0])

  const handleNextButtonClick = () => {
    navigate('/Story', { state: { selectedOptions,id } });
  };

  const handleBackButtonClick = () => {
    navigate('/Character', {state: {id}});
  };


  return (
    <div className='storyTopic'>
        <div className="d-flex justify-content-between p-3 bg-light">
            <button className="btn btn-primary" onClick={handleBackButtonClick}>
              <KeyboardDoubleArrowLeftIcon />
            </button>
          <div className="d-flex flex-row justify-content-start">
          <div className="p-3 d-flex align-items-center"> 
               <img src={selectedOptions[0].img}  style={{width: "70px", marginRight: "10px"}} />
               <img src={bookData[0].Book.Characters[0].img} style={{width: "70px", marginRight: "50px"}} />  {/* Adjust width as per requirement */}
              </div>
            <div className="sectionTitle display-4">{bookData[0].Book.Name}</div>
          </div>
          <button className="btn btn-primary" onClick={handleNextButtonClick}>
            <KeyboardDoubleArrowRightIcon />
          </button>
        </div>
        <div className='cover'>
          <img src={bookData[0].Book.Cover}></img>
        </div>
      </div>
  )
}

export default StoryTopic;