import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Face from './pages/Face';
import Display from './pages/Display';
import Faculty from './pages/Faculty';
import Admin from './pages/Admin';
import Home from './pages/Home';
import CameraTest from './pages/CameraTest';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/face" element={<Face />} />
        <Route path="/display" element={<Display />} />
        <Route path="/faculty" element={<Faculty />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/cameratest" element={<CameraTest />} />
      </Routes>
    </BrowserRouter>
  );
}
