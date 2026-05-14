import React, { useState, useEffect } from 'react';
import { Button } from 'react-hextech';
import { apiPost, apiGet } from '../hooks/useApi';

function ProcessingPanel({ addLog }) {
    const [regions, setRegions] = useState([]);
    const [aggregateRegion, setAggregateRegion] = useState('all');
    const [publishRegion, setPublishRegion] = useState('all');

    // Load regions from backend
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const { ok, data } = await apiGet('/config/regions');
                if (ok) {
                    setRegions(data.regions || []);
                }
            } catch (err) {
                console.error('Failed to load config:', err);
            }
        };
        loadConfig();
    }, []);

    const handleAggregate = async () => {
        const regionLabel = aggregateRegion === 'all' ? 'Global' : aggregateRegion;
        addLog(`Starting data aggregation for ${regionLabel}...`, 'info');
        try {
            const { ok, data } = await apiPost('/action/aggregate', { region: aggregateRegion });
            addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
        } catch (err) {
            addLog(`Error: ${err.message}`, 'error');
        }
    };

    const handlePublish = async () => {
        const regionLabel = publishRegion === 'all' ? 'Global' : publishRegion;
        addLog(`Starting publish to Firebase for ${regionLabel}...`, 'info');
        try {
            const { ok, data } = await apiPost('/action/publish', { region: publishRegion });
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
                    <div className="action-card-config">
                        <label className="config-label-sm">Region</label>
                        <select 
                            className="hex-select hex-select-sm" 
                            value={aggregateRegion} 
                            onChange={e => setAggregateRegion(e.target.value)} 
                            id="select-aggregate-region"
                        >
                            <option value="all">🌍 Global (All Regions)</option>
                            {regions.map(r => (
                                <option key={r.name} value={r.name}>{r.name}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ marginTop: 'auto', paddingTop: '12px' }}>
                        <Button onClick={handleAggregate}>Run Aggregation</Button>
                    </div>
                </div>

                <div className="card glass action-card">
                    <div className="icon">🚀</div>
                    <h3>Publish to App</h3>
                    <p>Upload aggregated stats to Firebase</p>
                    <div className="action-card-config">
                        <label className="config-label-sm">Region</label>
                        <select 
                            className="hex-select hex-select-sm" 
                            value={publishRegion} 
                            onChange={e => setPublishRegion(e.target.value)} 
                            id="select-publish-region"
                        >
                            <option value="all">🌍 Global (All Regions)</option>
                            {regions.map(r => (
                                <option key={r.name} value={r.name}>{r.name}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ marginTop: 'auto', paddingTop: '12px' }}>
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
