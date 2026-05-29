import React, { useState, useEffect, useMemo } from 'react';
import { Button } from 'react-hextech';
import { apiGet } from '../hooks/useApi';

function AnalyticsPanel({ addLog, isAggregating }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRole, setFilterRole] = useState('All');
    const [filterLane, setFilterLane] = useState('All');
    
    // View Mode & Sorting state
    const [viewMode, setViewMode] = useState('tierlist');
    const [sortConfig, setSortConfig] = useState({ key: 'score', direction: 'desc' });

    const handleViewModeChange = (mode) => {
        setViewMode(mode);
        if (mode === 'tierlist') {
            setSortConfig({ key: 'score', direction: 'desc' });
        } else {
            setSortConfig({ key: 'winRate', direction: 'desc' });
        }
    };

    useEffect(() => {
        if (isAggregating) return; // Don't fetch while aggregation is in progress

        const fetchAnalytics = async () => {
            setLoading(true);
            try {
                const { ok, data: responseData } = await apiGet('/data/analytics/summary');
                if (ok && responseData.data) {
                    setData(responseData.data);
                } else {
                    addLog('Failed to load analytics data or data is empty. Have you aggregated?', 'error');
                }
            } catch (err) {
                addLog(`Error loading analytics: ${err.message}`, 'error');
            }
            setLoading(false);
        };
        fetchAnalytics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAggregating]);

    const handleManualRefresh = async () => {
        setLoading(true);
        try {
            const { ok, data: responseData } = await apiGet('/data/analytics/summary');
            if (ok && responseData.data) setData(responseData.data);
        } catch (err) {}
        setLoading(false);
    };

    // Parse percentage strings to numbers for sorting
    const parsePercent = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        return parseFloat(val.replace('%', ''));
    };

    const handleSort = (key) => {
        let direction = 'desc';
        if (sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const getPrimaryLanes = (champ) => {
        if (!champ.laneWinRates) return champ.lane ? champ.lane.slice(0, 2) : [];
        return Object.entries(champ.laneWinRates)
            .sort((a, b) => b[1].games - a[1].games)
            .map(entry => entry[0])
            .slice(0, 2); // Show top 2 primary lanes
    };

    const sortedData = useMemo(() => {
        let sortableItems = [...data];
        
        // Filter by search term
        if (searchTerm) {
            sortableItems = sortableItems.filter(item => 
                item.name.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Filter by role
        if (filterRole !== 'All') {
            sortableItems = sortableItems.filter(item => item.role && item.role.includes(filterRole));
        }

        // Filter by lane
        if (filterLane !== 'All') {
            sortableItems = sortableItems.filter(item => {
                const primaryLanes = getPrimaryLanes(item);
                return primaryLanes.includes(filterLane);
            });
        }

        // Sort
        sortableItems.sort((a, b) => {
            let aValue = a[sortConfig.key];
            let bValue = b[sortConfig.key];

            if (['winRate', 'pickRate', 'banRate'].includes(sortConfig.key)) {
                aValue = parsePercent(aValue);
                bValue = parsePercent(bValue);
            }

            if (aValue < bValue) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
        
        return sortableItems;
    }, [data, sortConfig, searchTerm, filterRole, filterLane]);

    const getSortIcon = (key) => {
        if (sortConfig.key === key) {
            return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
        }
        return '';
    };

    return (
        <div className="card glass analytics-panel">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h3>Data Analytics</h3>
                    <p>View aggregated champion statistics from the latest processing run.</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', background: 'rgba(9, 20, 28, 0.6)', padding: '4px', borderRadius: '4px', border: '1px solid rgba(200, 155, 60, 0.3)' }}>
                    <button 
                        className={`hex-input ${viewMode === 'tierlist' ? 'active-view' : ''}`}
                        style={{ 
                            background: viewMode === 'tierlist' ? 'rgba(200, 155, 60, 0.2)' : 'transparent',
                            borderColor: viewMode === 'tierlist' ? '#c89b3c' : 'transparent',
                            color: viewMode === 'tierlist' ? '#f0e6d2' : '#a09b8c',
                            cursor: 'pointer',
                            minWidth: 'auto',
                            padding: '6px 16px'
                        }}
                        onClick={() => handleViewModeChange('tierlist')}
                    >🏆 Tierlist View</button>
                    <button 
                        className={`hex-input ${viewMode === 'ranking' ? 'active-view' : ''}`}
                        style={{ 
                            background: viewMode === 'ranking' ? 'rgba(200, 155, 60, 0.2)' : 'transparent',
                            borderColor: viewMode === 'ranking' ? '#c89b3c' : 'transparent',
                            color: viewMode === 'ranking' ? '#f0e6d2' : '#a09b8c',
                            cursor: 'pointer',
                            minWidth: 'auto',
                            padding: '6px 16px'
                        }}
                        onClick={() => handleViewModeChange('ranking')}
                    >📈 Ranking View</button>
                </div>
            </div>

            <div className="analytics-toolbar">
                <div style={{ display: 'flex', gap: '12px' }}>
                    <input 
                        type="text" 
                        placeholder="Search champion..." 
                        className="hex-input"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <select className="hex-input" value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
                        <option value="All">All Roles</option>
                        <option value="Fighter">Fighter</option>
                        <option value="Mage">Mage</option>
                        <option value="Assassin">Assassin</option>
                        <option value="Marksman">Marksman</option>
                        <option value="Support">Support</option>
                        <option value="Tank">Tank</option>
                    </select>
                    <select className="hex-input" value={filterLane} onChange={(e) => setFilterLane(e.target.value)}>
                        <option value="All">All Lanes</option>
                        <option value="Top Lane">Top</option>
                        <option value="Jungle">Jungle</option>
                        <option value="Mid Lane">Middle</option>
                        <option value="Bottom Lane">Bottom</option>
                        <option value="Support">Support</option>
                    </select>
                    <Button onClick={handleManualRefresh} disabled={loading || isAggregating} style={{ padding: '8px 16px', height: '100%' }}>
                        🔄 Refresh
                    </Button>
                </div>
                <div className="analytics-meta">
                    {data.length > 0 && (
                        <span>
                            <strong>Patch:</strong> {data[0].patch} {data[0].isFallback ? '(Fallback)' : ''} | 
                            <strong> Region:</strong> {data[0].region} | 
                            <strong> Total:</strong> {data.length} Champions
                        </span>
                    )}
                </div>
            </div>

            <div className="table-container">
                {loading ? (
                    <div className="loading-state">Fetching analytics data...</div>
                ) : data.length === 0 ? (
                    <div className="empty-state">
                        <p>No analytics data found.</p>
                        <p style={{ fontSize: '0.9em', opacity: 0.7 }}>Please run Data Aggregation in the Processing tab first.</p>
                    </div>
                ) : (
                    <table className="hex-table">
                        <thead>
                            <tr>
                                <th>Champion</th>
                                <th onClick={() => handleSort('score')} className="sortable">Tier Score{getSortIcon('score')}</th>
                                <th onClick={() => handleSort('winRate')} className="sortable">Win Rate{getSortIcon('winRate')}</th>
                                <th onClick={() => handleSort('pickRate')} className="sortable">Pick Rate{getSortIcon('pickRate')}</th>
                                <th onClick={() => handleSort('banRate')} className="sortable">Ban Rate{getSortIcon('banRate')}</th>
                                <th>Roles</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.map((champ) => (
                                <tr key={champ.id}>
                                    <td className="champ-cell">
                                        {champ.icon && <img src={champ.icon} alt={champ.name} className="champ-icon" />}
                                        <span className="champ-name">{champ.name}</span>
                                    </td>
                                    <td>
                                        <span className={`score-badge ${champ.score >= 80 ? 's-tier' : champ.score >= 60 ? 'a-tier' : 'b-tier'}`}>
                                            {champ.score ? champ.score.toFixed(1) : 'N/A'}
                                        </span>
                                    </td>
                                    <td className={parsePercent(champ.winRate) >= 50 ? 'positive-rate' : 'negative-rate'}>
                                        {champ.winRate}
                                    </td>
                                    <td>{champ.pickRate}</td>
                                    <td>{champ.banRate}</td>
                                    <td>
                                        <div className="role-tags">
                                            {getPrimaryLanes(champ).map(l => (
                                                <span key={l} className="role-tag">{l}</span>
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

export default AnalyticsPanel;
