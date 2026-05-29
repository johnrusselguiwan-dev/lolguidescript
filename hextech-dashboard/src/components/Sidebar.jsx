import React from 'react';
import PatchCountdown from './PatchCountdown';

function Sidebar({ activeTab, setActiveTab, isUploading, isMerging, isAggregating, isPublishing, isSyncing, sidebarNotification, setSidebarNotification }) {
    return (
        <aside className="sidebar">
            <div className="logo">
                <h2>LoL Guide <span className="badge">Master</span></h2>
            </div>
            <nav>
                <button
                    className={activeTab === 'collection' ? 'active' : ''}
                    onClick={() => setActiveTab('collection')}
                >
                    ⚡ Data Collection
                </button>
                <button
                    className={activeTab === 'teamdata' ? 'active' : ''}
                    onClick={() => setActiveTab('teamdata')}
                >
                    👥 Team Data
                </button>
                <button
                    className={activeTab === 'processing' ? 'active' : ''}
                    onClick={() => setActiveTab('processing')}
                >
                    📦 Data Processing
                </button>
                <button
                    className={activeTab === 'analytics' ? 'active' : ''}
                    onClick={() => setActiveTab('analytics')}
                >
                    📊 Data Analytics
                </button>
            </nav>

            <div style={{ marginTop: 'auto' }}>
                {(isUploading || isMerging || isAggregating || isPublishing || isSyncing) && (
                    <div className="sidebar-progress" style={{ 
                        padding: '16px', 
                        background: 'rgba(200, 155, 60, 0.1)', 
                        borderTop: '1px solid rgba(200, 155, 60, 0.3)',
                        textAlign: 'center'
                    }}>
                        <div style={{ color: '#f0e6d2', fontWeight: 'bold', marginBottom: '8px', fontSize: '0.9rem' }}>
                            {isUploading && '⏳ Uploading Files...'}
                            {isMerging && '🔄 Merging Data...'}
                            {isAggregating && '📦 Aggregating Data...'}
                            {isPublishing && '🚀 Publishing Live...'}
                            {isSyncing && '🗄️ Syncing Assets...'}
                        </div>
                        <div className="import-progress-bar" style={{ height: '4px' }}>
                            <div className="import-progress-fill"></div>
                        </div>
                    </div>
                )}
                
                {!isUploading && !isMerging && !isAggregating && !isPublishing && !isSyncing && sidebarNotification && (
                    <div className={`sidebar-notification ${sidebarNotification.type}`} style={{ 
                        padding: '12px 16px', 
                        background: sidebarNotification.type === 'error' ? 'rgba(226, 44, 44, 0.15)' : 'rgba(16, 185, 129, 0.15)', 
                        borderTop: `1px solid ${sidebarNotification.type === 'error' ? 'rgba(226, 44, 44, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                        color: sidebarNotification.type === 'error' ? '#ffcccc' : '#a7f3d0'
                    }}>
                        <span>{sidebarNotification.message}</span>
                        <button 
                            onClick={() => setSidebarNotification(null)}
                            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px' }}
                            title="Close notification"
                        >×</button>
                    </div>
                )}

                <PatchCountdown />
            </div>
        </aside>
    );
}

export default Sidebar;
