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
        setPublishModal({ isOpen: true, environment: 'STAGING_DEBUG', targetCollection: 'staging_data' });
    };

    const handleCollectionChange = (newTarget) => {
        setPublishModal(prev => ({
            ...prev,
            targetCollection: newTarget,
            environment: newTarget === 'data' ? 'ALL' : 'STAGING_DEBUG'
        }));
    };

    const confirmPublish = async () => {
        const regionLabel = publishRegion === 'all' ? 'Global' : publishRegion;
        const env = publishModal.environment;
        const targetCollection = publishModal.targetCollection || 'staging_data';
        setPublishModal({ ...publishModal, isOpen: false });
        
        setIsPublishing(true);
        addLog(`Starting publish to Firebase [${targetCollection}] for ${regionLabel}...`, 'info');
        setSidebarNotification(null);
        try {
            const { ok, data } = await apiPost('/action/publish', { region: publishRegion, targetCollection });
            addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
            
            if (ok && data.result?.rcFields?.length > 0 && env !== 'NONE') {
                const envLabel = env === 'STAGING_DEBUG' ? 'Staging & Debug' : env;
                addLog(`Bumping remote config for ${envLabel}...`, 'info');
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
            message: `Are you sure you want to trigger a background asset sync?\n\nThis will fetch the latest champions, items, and runes from Riot's servers and publish them to staging_data.`,
            action: async () => {
                setModal({ isOpen: false, title: '', message: '', action: null });
                setIsSyncing(true);
                addLog('Triggering background asset sync (staging_data)...', 'info');
                setSidebarNotification(null);
                try {
                    const { ok, data } = await apiPost('/action/sync-assets', { targetCollection: 'staging_data' });
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
                    backgroundColor: 'rgba(1, 10, 19, 0.85)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    zIndex: 1000,
                    display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <div className="card glass" style={{
                        maxWidth: '520px',
                        width: '92%',
                        padding: '24px',
                        border: '1px solid #c89b3c',
                        boxShadow: '0 0 30px rgba(0, 0, 0, 0.9), 0 0 15px rgba(200, 155, 60, 0.2)',
                        textAlign: 'left'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(200, 155, 60, 0.3)', paddingBottom: '12px' }}>
                            <h3 style={{ color: '#f0e6d2', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.2rem', letterSpacing: '0.5px' }}>
                                <span>🚀</span> Publish & Bump Config
                            </h3>
                            <button 
                                onClick={() => setPublishModal({ ...publishModal, isOpen: false })}
                                style={{ background: 'transparent', border: 'none', color: '#a09b8c', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px', lineHeight: 1 }}
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <p style={{ color: '#a09b8c', lineHeight: 1.5, marginBottom: '20px', fontSize: '0.9rem', textAlign: 'left' }}>
                            Publishing data for <strong style={{ color: '#f0e6d2' }}>{publishRegion === 'all' ? 'Global (All Regions)' : publishRegion}</strong> to Firebase Firestore.
                        </p>

                        {/* Section 1: Target Collection */}
                        <div style={{
                            marginBottom: '16px',
                            background: 'rgba(2, 14, 26, 0.75)',
                            border: publishModal.targetCollection === 'data' ? '1px solid rgba(226, 76, 76, 0.6)' : '1px solid rgba(200, 155, 60, 0.25)',
                            borderRadius: '6px',
                            padding: '14px 16px',
                            textAlign: 'left',
                            transition: 'border-color 0.2s ease'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c8aa6e', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                    Target Firestore Collection
                                </label>
                                <span style={{
                                    fontSize: '0.7rem',
                                    padding: '2px 8px',
                                    borderRadius: '3px',
                                    fontWeight: 600,
                                    background: publishModal.targetCollection === 'data' ? 'rgba(226, 76, 76, 0.2)' : 'rgba(10, 200, 185, 0.15)',
                                    color: publishModal.targetCollection === 'data' ? '#ff6b6b' : '#0ac8b9',
                                    border: publishModal.targetCollection === 'data' ? '1px solid rgba(226, 76, 76, 0.4)' : '1px solid rgba(10, 200, 185, 0.3)'
                                }}>
                                    {publishModal.targetCollection === 'data' ? '⚠️ PRODUCTION' : '🧪 STAGING'}
                                </span>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: '#a09b8c', margin: '0 0 10px 0', lineHeight: 1.4, textAlign: 'left' }}>
                                {publishModal.targetCollection === 'data'
                                    ? 'Directly updates production Firestore. Live app users will receive this data.'
                                    : 'Default safe route. Uploads to staging_data without affecting production users.'}
                            </p>
                            <select 
                                className="hex-select hex-select-sm" 
                                value={publishModal.targetCollection || 'staging_data'}
                                onChange={e => handleCollectionChange(e.target.value)}
                                id="select-publish-collection"
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            >
                                <option value="staging_data">🧪 Staging (staging_data) - Default Safe</option>
                                <option value="data">🚀 Production (data) - Live Mobile App</option>
                            </select>
                        </div>

                        {/* Section 2: Remote Config Environment */}
                        <div style={{
                            marginBottom: '24px',
                            background: 'rgba(2, 14, 26, 0.75)',
                            border: '1px solid rgba(200, 155, 60, 0.25)',
                            borderRadius: '6px',
                            padding: '14px 16px',
                            textAlign: 'left'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c8aa6e', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                    Target Environment for Remote Config Bump
                                </label>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: '#a09b8c', margin: '0 0 10px 0', lineHeight: 1.4, textAlign: 'left' }}>
                                Select which app environments should immediately increment version counters and detect the update.
                            </p>
                            <select 
                                className="hex-select hex-select-sm" 
                                value={publishModal.environment}
                                onChange={e => setPublishModal({...publishModal, environment: e.target.value})}
                                id="select-publish-environment"
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            >
                                <option value="STAGING_DEBUG">🧪 Staging & Debug Only (Staging + Debug)</option>
                                <option value="ALL">🌍 ALL (Prod + Staging + Debug)</option>
                                <option value="Staging">🧪 Staging Only</option>
                                <option value="Debug">🐞 Debug Only</option>
                                <option value="PROD">🚀 PROD Only</option>
                                <option value="NONE">❌ None (Only upload data)</option>
                            </select>
                        </div>

                        {/* Modal Action Buttons */}
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
                    backgroundColor: 'rgba(1, 10, 19, 0.85)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    zIndex: 1000,
                    display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <div className="card glass" style={{ maxWidth: '500px', width: '90%', padding: '24px', border: '1px solid #c89b3c', textAlign: 'left' }}>
                        <h3 style={{ color: '#f0e6d2', marginTop: 0, marginBottom: '16px', borderBottom: '1px solid rgba(200, 155, 60, 0.3)', paddingBottom: '12px', textAlign: 'left' }}>
                            {modal.title}
                        </h3>
                        <p style={{ color: '#a09b8c', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: '24px', textAlign: 'left' }}>
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
