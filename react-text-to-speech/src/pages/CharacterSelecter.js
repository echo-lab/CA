import React from 'react'
import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import CharacterCard from "../components/CharacterCard.js"
import "../styles/CharacterSelecter.css";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";

function CharaterSelecter() {
  const location = useLocation()
  const { id } = location.state
  console.log("CharaterSelecter:",id)
  return (
    <div>
      <div className='row'>
        <div className='rightbutton col-1'>
          <Link to="/"><button className="btn btn-primary"><i><KeyboardDoubleArrowLeftIcon /></i></button></Link>
        </div>
        <div className='col-8'>
        <div className='font-weight-bold font-italic display-3 m-5'>Select Character</div>
          <CharacterCard id={id}></CharacterCard>
        </div>
        <div className='leftbutton col-1'>
          <Link to="/story"><button className="btn btn-primary"><i><KeyboardDoubleArrowRightIcon /></i></button></Link>
        </div> 
      </div>  
    </div>
  )
}

export default CharaterSelecter
