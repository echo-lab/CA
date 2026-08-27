import React, { useEffect } from 'react';
import './App.css';
import Home from './pages/Home';
import Admin from './pages/Admin';
import Story from './pages/Story';
import Signup from './pages/Signup';
import ChildrenAvatarSelecter from './pages/ChildrenAvatarSelecter';
import CharacterSelecter from './pages/CharacterSelecter';
import AvatarSelecter from './pages/AvatarSelecter';
import LandingPage from './pages/LandingPage';
import { AudioStreamControlProvider } from './utils/AudioStreamControl';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { resolveParticipantFromUrl } from './utils/participant';

function App() {
  // Resolve ?pid=<id> once at startup, on whatever route the link landed on,
  // so a handed-out participant link works from the landing page too.
  useEffect(() => {
    resolveParticipantFromUrl().catch((err) =>
      console.warn('[participant] ?pid= not accepted:', err.message)
    );
  }, []);

  return (
    <div className="App">
      <AudioStreamControlProvider>
        <Router>
          <Routes>
            <Route path='/' element={<LandingPage />}/>
            <Route path='/ChildSelect' element={<ChildrenAvatarSelecter />}/>
            <Route path='/AvatarSelecter' element={<AvatarSelecter />}/>
            <Route path='/Signup' element={<Signup />}/>
            <Route path='/Home' element={<Home />}/>
            <Route path='/Admin' element={<Admin />}/>
            <Route path='/Story' element={<Story />}/>
            <Route path='/Character' element={<CharacterSelecter />}/>
          </Routes>
        </Router>
      </AudioStreamControlProvider>
    </div>
  );
}

export default App;