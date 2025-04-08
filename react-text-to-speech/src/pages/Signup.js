import React from 'react';
import '../styles/signup.css';
import image2 from '../Pictures/Mates-05.png'
import SentimentVerySatisfiedIcon from '@mui/icons-material/SentimentVerySatisfied';
import  { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function Signup() {
  const [userName, setUserName] = useState(''); // Keep this state for the input field
  const navigate = useNavigate(); // Hook for programmatic navigation

  const handleSubmit = (e) => {
    e.preventDefault();
    navigate('/ChildSelect', { state: { userName: userName } }); // Navigate with conditional userName
  };

  return (
    <div className="signup">
      <div className="signupcard">
        <div className='row row-signup'>
          <div className="col-md-6 left-column">
            <img src={image2} className="card-img" alt="" />
          </div>
          <div className="col-md-6 right-column">
            <div className="welcome-header">
              <span className="icon"><SentimentVerySatisfiedIcon fontSize="large"/></span>
              <h3 className="welcome-text">Welcome!</h3>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="name">Name:</label>
                <input 
                  type="text" 
                  className="form-control" 
                  id="name"
                  placeholder="What's your child's name?"
                  value={userName} // Controlled component
                  onChange={(e) => setUserName(e.target.value)} // Update state on change
                />
              </div>
              <button type="submit" className="button">Start</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Signup;
