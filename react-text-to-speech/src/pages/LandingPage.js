import React from "react";
import { Link } from "react-router-dom";
import "../styles/LandingPage.css";
import labLogos from "../Pictures/labImg.png"; 
const LandingPage = () => {
  return (
    <div className="landing-container">
      <header className="hero-section">
        {/* Logo Container */}
        <div className="logo-container">
          <img src={labLogos} alt="Echolab, Cobelab, Learning & Development Lab, Virginia Tech" className="lab-logos" />
        </div>
        
        <div className="hero-content">
          <h1>TaleMate: A Reading Platform for Parents and Children</h1>
          <p>
            Welcome to TaleMate – an innovative, interactive storytelling platform designed to foster parent–child collaboration in early literacy. Our research-driven approach aims to transform joint reading into an engaging, dynamic experience.
          </p>
          <p>
            Learn more about our project and its scientific foundations on our research page:{" "}
            <a
              href="https://echolab.cs.vt.edu/2023/08/28/talemate-a-reading-platform-for-parents-and-children/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn More
            </a>
          </p>
          <Link to="/Signup">
            <button className="start-button">Get Started</button>
          </Link>
        </div>
      </header>
      <footer className="footer">
        <p>&copy; 2025 TaleMate Research Initiative</p>
      </footer>
    </div>
  );
};

export default LandingPage;
