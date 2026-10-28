import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../App.js';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + String(e.reason && e.reason.message || e.reason)));
const origError = console.error;
console.error = (...a) => { window.__errors.push(a.map(String).join(' ')); origError(...a); };

createRoot(document.getElementById('root')).render(<App />);
