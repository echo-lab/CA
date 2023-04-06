import React from 'react'
import {Link} from 'react-router-dom'
import Logo from '../Pictures/logo.png'

function NavigationBar() {

  return (
        <nav class="navbar navbar-light bg-light" >
            <ul class="nav navbar-nav navbar-right"></ul>
            <a class="navbar-brand" href="#">
            <img src={Logo} width="30" height="30" class="d-inline-block align-top" alt=""/>
              App Name
            </a>
    </nav>
  );
}

export default NavigationBar
