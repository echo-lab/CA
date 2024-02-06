import React from 'react';
import '../styles/signup.css';
import { Link } from 'react-router-dom'
import image2 from '../Pictures/Mates-05.png'
import SentimentVerySatisfiedIcon from '@mui/icons-material/SentimentVerySatisfied';

function Signup(){
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
              <form>
                    <div className="form-group">
                        <label htmlFor="name">Name:</label>
                        <input 
                          type="text" 
                          className="form-control" 
                          placeholder="What's your name"
                        />
                    </div>
                    <Link to="/Home"><button type="submit" className="button">Start</button></Link>
                    </form>
              </div>
            </div>
        </div>
    </div>
  );
}

export default Signup;
