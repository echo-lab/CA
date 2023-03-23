import React from 'react'
import {Link} from 'react-router-dom'
import Logo from '../Pictures/logo.png'
import '../styles/NavigationBar.css'

function NavigationBar() {

  return (
    <div className='navbar'>
      <div className='leftSide'>
        <img src={Logo}></img>
      </div>
        
      <div className='rightSide'>
        <Link to="/">Home</Link>
        <Link to="/story">Story</Link>
        <Link to="/profile">Profile</Link>       
      </div>
    </div>
    
  );
}

export default NavigationBar
