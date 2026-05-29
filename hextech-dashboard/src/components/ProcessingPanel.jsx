import React, { useState, useEffect } from 'react';
import { Button } from 'react-hextech';
import { apiPost, apiGet } from '../hooks/useApi';

function ProcessingPanel({ addLog, isAggregating, setIsAggregating, isPublishing, setIsPublishing, isSyncing, setIsSyncing, setSidebarNotification }) {
    const [regions, setRegions] = useState([]);
    const [aggregateRegion, setAggregateRegion] = useState('all');
    const [publishRegion, setPublishRegion] = useState('all');
    const [fallbackWarning, setFallbackWarning] = useState(false);

    // Modal State
    const [modal, setModal] = useState({ isOpen: false, title: '', message: '', action: null });
    const [publishModal, setPublishModal] = useState({ isOpen: false, environment: 'ALL' });

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
        if (isAggregating || isPublishing || isSyncing) {
            setModal({
                isOpen: true,
                title: 'Action Blocked',
                message: 'Another process is currently running. Please wait for it to finish before starting a new one.',
                action: null
            });
            return;
        }
        const regionLabel = aggregateRegion === 'all' ? 'Global' : aggregateRegion;
        setModal({
            isOpen: true,
            title: 'Confirm Aggregation',
            message: `Are you sure you want to aggregate data for ${regionLabel}?\n\nThis process may take a few minutes depending on the database size.`,
            action: async () => {
                setModal({ isOpen: false, title: '', message: '', action: null });
                setIsAggregating(true);
                addLog(`Starting data aggregation for ${regionLabel}...`, 'info');
                setSidebarNotification(null);
                try {
                    const { ok, data } = await apiPost('/action/aggregate', { region: aggregateRegion });
                    addLog(ok ? data.message : data.error, ok ? (data.result?.isFallback ? 'warning' : 'success') : 'error');
                    setFallbackWarning(ok && data.result?.isFallback);
                    setSidebarNotification({ type: ok ? 'success' : 'error', message: ok ? '✅ Aggregation Finished' : '❌ Aggregation Failed' });
                } catch (err) {
                    addLog(`Error: ${err.message}`, 'error');
                    setSidebarNotification({ type: 'error', message: '❌ Aggregation Error' });
                }
                setIsAggregating(false);
            }
        });
    };

    const handlePublish = () => {
        if (isAggregating || isPublishing || isSyncing) {
            setModal({
                isOpen: true,
                title: 'Action Blocked',
                message: 'Another process is currently running. Please wait for it to finish before starting a new one.',
                action: null
            });
            return;
        }
        setPublishModal({ isOpen: true, environment: 'ALL' });
    };

    const confirmPublish = async () => {
        const regionLabel = publishRegion === 'all' ? 'Global' : publishRegion;
        const env = publishModal.environment;
        setPublishModal({ ...publishModal, isOpen: false });
        
        setIsPublishing(true);
        addLog(`Starting publish to Firebase for ${regionLabel}...`, 'info');
        setSidebarNotification(null);
        try {
            const { ok, data } = await apiPost('/action/publish', { region: publishRegion });
            addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
            
            if (ok && data.result?.rcFields?.length > 0 && env !== 'NONE') {
                addLog(`Bumping remote config for ${env}...`, 'info');
                try {
                    const bumpRes = await apiPost('/action/bump-version', { 
                        rcFields: data.result.rcFields, 
                        patch: data.result.patch || 'unknown', 
                        environment: env 
                    });
                    addLog(bumpRes.ok ? bumpRes.data.message : bumpRes.data.error, bumpRes.ok ? 'success' : 'error');
                } catch(e) {
                    addLog(`Bump Error: ${e.message}`, 'error');
                }
            }
            setSidebarNotification({ type: ok ? 'success' : 'error', message: ok ? '✅ Publish Complete' : '❌ Publish Failed' });
        } catch (err) {
            addLog(`Error: ${err.message}`, 'error');
            setSidebarNotification({ type: 'error', message: '❌ Publish Error' });
        }
        setIsPublishing(false);
    };

    const handleSync = async () => {
        if (isAggregating || isPublishing || isSyncing) {
            setModal({
                isOpen: true,
                title: 'Action Blocked',
                message: 'Another process is currently running. Please wait for it to finish before starting a new one.',
                action: null
            });
            return;
        }
        setModal({
            isOpen: true,
            title: 'Confirm Asset Sync',
            message: `Are you sure you want to trigger a background asset sync?\n\nThis will fetch the latest champions, items, and runes from Riot's servers.`,
            action: async () => {
                setModal({ isOpen: false, title: '', message: '', action: null });
                setIsSyncing(true);
                addLog('Triggering background asset sync...', 'info');
                setSidebarNotification(null);
                try {
                    const { ok, data } = await apiPost('/action/sync-assets');
                    addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
                    setSidebarNotification({ type: ok ? 'success' : 'error', message: ok ? '✅ Asset Sync Complete' : '❌ Asset Sync Failed' });
                } catch (err) {
                    addLog(`Error: ${err.message}`, 'error');
                    setSidebarNotification({ type: 'error', message: '❌ Asset Sync Error' });
                }
                setIsSyncing(false);
            }
        });
    };

    return (
        <div className="tab-content" id="tab-processing">
            {/* Combined Publish Modal */}
            {publishModal.isOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.75)', zIndex: 1000,
                    display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <div className="card glass" style={{ maxWidth: '500px', width: '90%', padding: '24px', border: '1px solid #c89b3c' }}>
                        <h3 style={{ color: '#f0e6d2', marginTop: 0, marginBottom: '16px', borderBottom: '1px solid rgba(200, 155, 60, 0.3)', paddingBottom: '12px' }}>
                            🚀 Publish & Bump Config
                        </h3>
                        <p style={{ color: '#a09b8c', lineHeight: 1.5, marginBottom: '24px' }}>
                            Are you sure you want to publish data for <strong>{publishRegion === 'all' ? 'Global' : publishRegion}</strong> to Firebase? This will overwrite live data in the app.
                        </p>
                        <div className="action-card-config" style={{ marginBottom: '24px', background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px' }}>
                            <label className="config-label-sm" style={{ marginBottom: '8px' }}>Target Environment for Remote Config Bump</label>
                            <p style={{ fontSize: '0.8rem', color: '#a09b8c', margin: '0 0 12px 0' }}>Select which environments should immediately detect the new patch update.</p>
                            <select 
                                className="hex-select hex-select-sm" 
                                value={publishModal.environment}
                                onChange={e => setPublishModal({...publishModal, environment: e.target.value})}
                            >
                                <option value="ALL">ALL (Prod + Staging + Debug)</option>
                                <option value="PROD">PROD Only</option>
                                <option value="Staging">Staging Only</option>
                                <option value="Debug">Debug Only</option>
                                <option value="NONE">None (Just upload data)</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <Button onClick={() => setPublishModal({...publishModal, isOpen: false})} style={{ background: 'transparent', border: '1px solid #a09b8c', color: '#a09b8c' }}>
                                Cancel
                            </Button>
                            <Button onClick={confirmPublish}>
                                Publish Data
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
                                {modal.action ? 'Cancel' : 'Close'}
                            </Button>
                            {modal.action && (
                                <Button onClick={modal.action}>
                                    Confirm
                                </Button>
                            )}
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
                        <Button onClick={handleAggregate} disabled={isAggregating}>
                            {isAggregating ? '⏳ Aggregating...' : 'Run Aggregation'}
                        </Button>
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
                        <Button onClick={handlePublish} disabled={isPublishing}>
                            {isPublishing ? '⏳ Publishing...' : 'Publish Data'}
                        </Button>
                    </div>
                </div>

                <div className="card glass action-card">
                    <div className="icon">🗄️</div>
                    <h3>Sync Assets</h3>
                    <p>Fetch newest champions, items, and runes</p>
                    <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                        <Button onClick={handleSync} disabled={isSyncing}>
                            {isSyncing ? '⏳ Syncing...' : 'Sync Now'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ProcessingPanel;
