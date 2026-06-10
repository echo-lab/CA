import React from 'react'
import Logo from '../Pictures/Mates-07.png'

function NavigationBar() {

  return (
        <nav className="navbar navbar-light bg-light" >
            <ul className="nav navbar-nav navbar-right"></ul>
            <a className="navbar-brand" href="#">
            <img src={Logo} width="300" height="auto" className="d-inline-block align-left" alt=""/>
              TaleMate
            </a>
    </nav>
  );
}

export default NavigationBar
