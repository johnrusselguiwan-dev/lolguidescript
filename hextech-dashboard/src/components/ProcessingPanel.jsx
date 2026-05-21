import React, { useState, useEffect } from 'react';
import { Button } from 'react-hextech';
import { apiPost, apiGet } from '../hooks/useApi';

function ProcessingPanel({ addLog }) {
    const [regions, setRegions] = useState([]);
    const [aggregateRegion, setAggregateRegion] = useState('all');
    const [publishRegion, setPublishRegion] = useState('all');
    const [fallbackWarning, setFallbackWarning] = useState(false);
    
    // Modal State
    const [modal, setModal] = useState({ isOpen: false, title: '', message: '', action: null });
    const [bumpModal, setBumpModal] = useState({ isOpen: false, rcFields: [], patch: '', environment: 'ALL' });

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
        setModal({
            isOpen: true,
            title: 'Confirm Aggregation',
            message: `Are you sure you want to aggregate data for ${regionLabel}?\n\nThis process may take a few minutes depending on the database size.`,
            action: async () => {
                setModal({ isOpen: false, title: '', message: '', action: null });
                addLog(`Starting data aggregation for ${regionLabel}...`, 'info');
                try {
                    const { ok, data } = await apiPost('/action/aggregate', { region: aggregateRegion });
                    addLog(ok ? data.message : data.error, ok ? (data.result?.isFallback ? 'warning' : 'success') : 'error');
                    setFallbackWarning(ok && data.result?.isFallback);
                } catch (err) {
                    addLog(`Error: ${err.message}`, 'error');
                }
            }
        });
    };

    const handlePublish = async () => {
        const regionLabel = publishRegion === 'all' ? 'Global' : publishRegion;
        setModal({
            isOpen: true,
            title: 'Confirm Publish',
            message: `Are you sure you want to publish data for ${regionLabel} to Firebase?\n\nThis will overwrite live data in the application.`,
            action: async () => {
                setModal({ isOpen: false, title: '', message: '', action: null });
                addLog(`Starting publish to Firebase for ${regionLabel}...`, 'info');
                try {
                    const { ok, data } = await apiPost('/action/publish', { region: publishRegion });
                    addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
                    
                    if (ok && data.result?.rcFields?.length > 0) {
                        setBumpModal({ 
                            isOpen: true, 
                            rcFields: data.result.rcFields, 
                            patch: data.result.patch || 'unknown',
                            environment: 'ALL' 
                        });
                    }
                } catch (err) {
                    addLog(`Error: ${err.message}`, 'error');
                }
            }
        });
    };

    const handleSync = async () => {
        setModal({
            isOpen: true,
            title: 'Confirm Asset Sync',
            message: `Are you sure you want to trigger a background asset sync?\n\nThis will fetch the latest champions, items, and runes from Riot's servers.`,
            action: async () => {
                setModal({ isOpen: false, title: '', message: '', action: null });
                addLog('Triggering background asset sync...', 'info');
                try {
                    const { ok, data } = await apiPost('/action/sync-assets');
                    addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
                } catch (err) {
                    addLog(`Error: ${err.message}`, 'error');
                }
            }
        });
    };

    return (
        <div className="tab-content" id="tab-processing">
            {/* Remote Config Bump Modal */}
            {bumpModal.isOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.75)', zIndex: 1000,
                    display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <div className="card glass" style={{ maxWidth: '500px', width: '90%', padding: '24px', border: '1px solid #c89b3c' }}>
                        <h3 style={{ color: '#f0e6d2', marginTop: 0, marginBottom: '16px', borderBottom: '1px solid rgba(200, 155, 60, 0.3)', paddingBottom: '12px' }}>
                            🔢 Bump Remote Config Versions?
                        </h3>
                        <p style={{ color: '#a09b8c', lineHeight: 1.5, marginBottom: '24px' }}>
                            Publishing successful! Do you want to increment the Remote Config version fields so the mobile app detects the new Patch {bumpModal.patch} update?
                        </p>
                        <div className="action-card-config" style={{ marginBottom: '24px' }}>
                            <label className="config-label-sm">Environment</label>
                            <select 
                                className="hex-select hex-select-sm" 
                                value={bumpModal.environment}
                                onChange={e => setBumpModal({...bumpModal, environment: e.target.value})}
                            >
                                <option value="ALL">ALL (Prod + Staging + Debug)</option>
                                <option value="PROD">PROD Only</option>
                                <option value="Staging">Staging Only</option>
                                <option value="Debug">Debug Only</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <Button onClick={() => setBumpModal({...bumpModal, isOpen: false})} style={{ background: 'transparent', border: '1px solid #a09b8c', color: '#a09b8c' }}>
                                Skip
                            </Button>
                            <Button onClick={async () => {
                                const payload = { rcFields: bumpModal.rcFields, patch: bumpModal.patch, environment: bumpModal.environment };
                                setBumpModal({ ...bumpModal, isOpen: false });
                                addLog(`Bumping remote config for ${payload.environment}...`, 'info');
                                try {
                                    const { ok, data } = await apiPost('/action/bump-version', payload);
                                    addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
                                } catch(e) {
                                    addLog(`Bump Error: ${e.message}`, 'error');
                                }
                            }}>
                                Bump Versions
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hextech Modal */}
            {modal.isOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.75)', zIndex: 1000,
                    display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <div className="card glass" style={{ maxWidth: '500px', width: '90%', padding: '24px', border: '1px solid #c89b3c' }}>
                        <h3 style={{ color: '#f0e6d2', marginTop: 0, marginBottom: '16px', borderBottom: '1px solid rgba(200, 155, 60, 0.3)', paddingBottom: '12px' }}>
                            {modal.title}
                        </h3>
                        <p style={{ color: '#a09b8c', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: '24px' }}>
                            {modal.message}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <Button onClick={() => setModal({ isOpen: false, title: '', message: '', action: null })} style={{ background: 'transparent', border: '1px solid #a09b8c', color: '#a09b8c' }}>
                                Cancel
                            </Button>
                            <Button onClick={modal.action}>
                                Confirm
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {fallbackWarning && (
                <div className="alert alert-warning" style={{ marginBottom: '20px', padding: '15px', background: 'rgba(200, 155, 60, 0.2)', borderLeft: '4px solid #c89b3c', color: '#f0e6d2' }}>
                    <strong>⚠️ Fallback Patch Active:</strong> The aggregator detected insufficient matches for the current patch and has fallen back to a previous patch to ensure statistical accuracy. Some item or champion data may reflect the previous patch.
                </div>
            )}
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
