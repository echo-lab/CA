import React from 'react';
import '../styles/signup.css';
import image2 from '../Pictures/Mates-05.png'
import SentimentVerySatisfiedIcon from '@mui/icons-material/SentimentVerySatisfied';
import  { useState } from 'react';
import { useNavigate } from 'react-router-dom';


function Signup(){
  const [userName, setUserName] = useState(''); // State to hold the user's name
  const navigate = useNavigate(); // Hook for programmatic navigation
   // Function to handle form submission
   const handleSubmit = (e) => {
    e.preventDefault(); // Prevent the default form submission
    navigate('/Home', { state: { userName } }); // Navigate to '/Home' with userName state
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
            <form onSubmit={handleSubmit}> {/* Updated form to use handleSubmit */}
              <div className="form-group">
                <label htmlFor="name">Name:</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="What's your name"
                  value={userName} // Controlled component
                  onChange={(e) => setUserName(e.target.value)} // Update state on change
                />
              </div>
              <button type="submit" className="button">Start</button> {/* Use button to submit form */}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}


export default Signup;
