import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { IS_DEMO } from './api.js';
import './styles.css';

// GitHub Pages는 서버 라우팅이 없으므로 데모에서는 #/ 주소 방식 사용
const Router = IS_DEMO ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
);
