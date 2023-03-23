import React from 'react';
import './App.css';
import NavigationBar from './components/NavigationBar';
import Home from './pages/Home';
import Story from './pages/Story';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <div className="App">
      <Router>
        <NavigationBar />
        <Routes>
          <Route path='/' element={<Home />}/>
          <Route path='/Story' element={<Story />}/>
        </Routes>
     </Router>
    </div>
  );
}

export default App;
