import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { setupGlobalDebugTools } from './utils/logger.ts'
import './index.css'

// Initialize debug tools for console
setupGlobalDebugTools()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
