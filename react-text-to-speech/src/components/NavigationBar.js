import React from 'react'
import {Link} from 'react-router-dom'
import Logo from '../Pictures/Mates-07.png'

function NavigationBar() {

  return (
        <nav className="navbar navbar-light bg-light" >
            <Link to="/" className="ms-3">
              <button className="btn btn-outline-danger">Exit</button>
            </Link>
            <a className="navbar-brand" href="#">
            <img src={Logo} width="300" height="auto" className="d-inline-block align-left me-3" alt=""/>
              TaleMate
            </a>
    </nav>
  );
}

export default NavigationBar
