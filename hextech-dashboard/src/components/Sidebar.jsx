import React from 'react';

function Sidebar({ activeTab, setActiveTab }) {
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
                    Data Collection
                </button>
                <button
                    className={activeTab === 'processing' ? 'active' : ''}
                    onClick={() => setActiveTab('processing')}
                >
                    Data Processing
                </button>
            </nav>
        </aside>
    );
}

export default Sidebar;
