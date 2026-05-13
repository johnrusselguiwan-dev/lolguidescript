import React from 'react';
import { Button } from 'react-hextech';
import { apiPost } from '../hooks/useApi';

function ProcessingPanel({ addLog }) {
    const handleAggregate = async () => {
        addLog('Starting data aggregation...', 'info');
        try {
            const { ok, data } = await apiPost('/action/aggregate');
            addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
        } catch (err) {
            addLog(`Error: ${err.message}`, 'error');
        }
    };

    const handlePublish = async () => {
        addLog('Starting publish to Firebase...', 'info');
        try {
            const { ok, data } = await apiPost('/action/publish');
            addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
        } catch (err) {
            addLog(`Error: ${err.message}`, 'error');
        }
    };

    const handleSync = async () => {
        addLog('Triggering background asset sync...', 'info');
        try {
            const { ok, data } = await apiPost('/action/sync-assets');
            addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
        } catch (err) {
            addLog(`Error: ${err.message}`, 'error');
        }
    };

    return (
        <div className="tab-content" id="tab-processing">
            <div className="grid-cards">
                <div className="card glass action-card">
                    <div className="icon">📦</div>
                    <h3>Aggregate Data</h3>
                    <p>Calculate win rates and builds from local matches</p>
                    <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                        <Button onClick={handleAggregate}>Run Aggregation</Button>
                    </div>
                </div>

                <div className="card glass action-card">
                    <div className="icon">🚀</div>
                    <h3>Publish to App</h3>
                    <p>Upload aggregated stats to Firebase</p>
                    <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                        <Button onClick={handlePublish}>Publish Data</Button>
                    </div>
                </div>

                <div className="card glass action-card">
                    <div className="icon">🗄️</div>
                    <h3>Sync Assets</h3>
                    <p>Fetch newest champions, items, and runes</p>
                    <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                        <Button onClick={handleSync}>Sync Now</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ProcessingPanel;
