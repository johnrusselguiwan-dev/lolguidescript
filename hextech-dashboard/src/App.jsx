import React, { useState, useEffect } from 'react';
import 'react-hextech/lib/style.css';
import './App.css';

import Sidebar from './components/Sidebar';
import ApiKeyForm from './components/ApiKeyForm';
import CrawlerPanel from './components/CrawlerPanel';
import ProcessingPanel from './components/ProcessingPanel';
import LogViewer from './components/LogViewer';
import { apiGet } from './hooks/useApi';

function App() {
  const [activeTab, setActiveTab] = useState('collection');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([{ msg: "Dashboard initialized. Welcome.", type: "info" }]);

  /** Client-side log entry for immediate feedback before server confirms */
  const addLog = (msg, type = "info") => {
    setLogs(prev => [...prev, { msg: `[${new Date().toLocaleTimeString()}] ${msg}`, type }]);
  };

  // Poll backend for status + server-side logs
  useEffect(() => {
    const poll = async () => {
      try {
        const statusRes = await apiGet('/status');
        if (statusRes.ok) {
          setIsRunning(statusRes.data.isRunning);
          setStatus(statusRes.data.state);
        }

        const logRes = await apiGet('/logs');
        if (logRes.ok && logRes.data.length > 0) {
          setLogs(logRes.data);
        }
      } catch (err) {
        console.error("Poll error", err);
      }
      setTimeout(poll, 2000);
    };
    poll();
  }, []);

  return (
    <div className="dashboard">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="content">
        <header>
          <h1>System Overview</h1>
          <div className="status-indicator">
            <span className={`dot ${isRunning ? 'online' : 'offline'}`}></span>
            <span>{isRunning ? 'System Running' : 'System Ready'}</span>
          </div>
        </header>

        {activeTab === 'collection' && (
          <div className="tab-content" id="tab-collection">
            <ApiKeyForm />
            <CrawlerPanel isRunning={isRunning} status={status} addLog={addLog} />
          </div>
        )}

        {activeTab === 'processing' && (
          <ProcessingPanel addLog={addLog} />
        )}

        <LogViewer logs={logs} />
      </main>
    </div>
  );
}

export default App;
