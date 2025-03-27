import React from 'react';
import './App.css';
import Home from './pages/Home';
import Story from './pages/Story';
import Signup from './pages/Signup';
import ChildrenAvatarSelecter from './pages/ChildrenAvatarSelecter';
import CharacterSelecter from './pages/CharacterSelecter';
import AvatarSelecter from './pages/AvatarSelecter';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <div className="App">
      <Router>
        <Routes>
          <Route path='/' element={<ChildrenAvatarSelecter />}/>
          <Route path='/AvatarSelecter' element={<AvatarSelecter />}/>
          <Route path='/Signup' element={<Signup />}/>
          <Route path='/Home' element={<Home />}/>
          <Route path='/Story' element={<Story />}/>
          <Route path='/Character' element={<CharacterSelecter />}/>
        </Routes>
     </Router>
    </div>
  );
}

export default App;