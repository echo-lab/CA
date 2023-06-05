import React from 'react'
import {Link} from 'react-router-dom'
import Logo from '../Pictures/Mates-07.png'

function NavigationBar() {

  return (
        <nav class="navbar navbar-light bg-light" >
            <ul class="nav navbar-nav navbar-right"></ul>
            <a class="navbar-brand" href="#">
            <img src={Logo} width="300" height="auto" class="d-inline-block align-left" alt=""/>
              Tale Mate
            </a>
    </nav>
  );
}

export default NavigationBar
