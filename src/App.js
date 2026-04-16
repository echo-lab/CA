import React from 'react';
import './App.css';
import Home from './pages/Home';
import Story from './pages/Story';
import Signup from './pages/Signup';
import ChildrenAvatarSelecter from './pages/ChildrenAvatarSelecter';
import CharacterSelecter from './pages/CharacterSelecter';
import ConditionSelecter from './pages/ConditionSelecter';
import Survey from './pages/Survey';
import AvatarSelecter from './pages/AvatarSelecter';
import LandingPage from './pages/LandingPage';
import { AudioStreamControlProvider } from './utils/AudioStreamControl';
import { UserProvider } from './utils/UserContext';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <div className="App">
      <UserProvider>
      <AudioStreamControlProvider>
        <Router>
          <Routes>
            <Route path='/' element={<LandingPage />}/>
            <Route path='/ChildSelect' element={<ChildrenAvatarSelecter />}/>
            <Route path='/AvatarSelecter' element={<AvatarSelecter />}/>
            <Route path='/Signup' element={<Signup />}/>
            <Route path='/Home' element={<Home />}/>
            <Route path='/Story' element={<Story />}/>
            <Route path='/Character' element={<CharacterSelecter />}/>
            <Route path='/Condition' element={<ConditionSelecter />}/>
            <Route path='/Survey' element={<Survey />}/>
          </Routes>
        </Router>
      </AudioStreamControlProvider>
      </UserProvider>
    </div>
  );
}

export default App;