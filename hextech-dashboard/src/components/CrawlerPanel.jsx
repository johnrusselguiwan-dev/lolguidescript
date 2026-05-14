import React, { useState, useEffect } from 'react';
import { Button } from 'react-hextech';
import { apiPost, apiGet } from '../hooks/useApi';

function CrawlerPanel({ isRunning, status, addLog }) {
    // Config state loaded from backend
    const [regions, setRegions] = useState([]);
    const [ranks, setRanks] = useState([]);

    // User selections
    const [selectedRegion, setSelectedRegion] = useState('all');
    const [rankStart, setRankStart] = useState(0);
    const [rankEnd, setRankEnd] = useState(0);
    const [strictPatch, setStrictPatch] = useState(true);

    // Fetch available regions and ranks from backend
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const { ok, data } = await apiGet('/config/regions');
                if (ok) {
                    setRegions(data.regions || []);
                    setRanks(data.ranks || []);
                    setRankEnd(data.ranks?.length || 0);
                }
            } catch (err) {
                console.error('Failed to load config:', err);
            }
        };
        loadConfig();
    }, []);

    const handleCrawl = async () => {
        if (isRunning) {
            // Stop
            try {
                const { ok, data } = await apiPost('/action/crawl/stop');
                addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
            } catch (err) {
                addLog(`Error: ${err.message}`, 'error');
            }
        } else {
            // Start with config
            try {
                const body = {
                    rankStart: parseInt(rankStart),
                    rankEnd: parseInt(rankEnd),
                    region: selectedRegion,
                    strictPatch
                };
                const { ok, data } = await apiPost('/action/crawl/start', body);
                addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
            } catch (err) {
                addLog(`Error: ${err.message}`, 'error');
            }
        }
    };

    const getProgressWidth = () => {
        if (!status) return '0%';
        const current = status.currentMatches || 0;
        return `${Math.min(100, Math.floor((current / 100) * 100))}%`;
    };

    const getRankText = () => {
        if (!status || status.rankIndex === undefined) return 'Not Running';
        const rank = ranks[status.rankIndex];
        return rank ? `Rank: ${rank.tier} ${rank.division}` : `Rank Index: ${status.rankIndex}`;
    };

    // Build rank label for dropdowns
    const getRankLabel = (idx) => {
        if (!ranks[idx]) return `Rank ${idx}`;
        return `${ranks[idx].tier} ${ranks[idx].division}`;
    };

    // Build unique tier groups for quick select
    const tiers = [...new Set(ranks.map(r => r.tier))];

    const handleTierQuickSelect = (tier) => {
        const first = ranks.findIndex(r => r.tier === tier);
        const last = ranks.length - 1 - [...ranks].reverse().findIndex(r => r.tier === tier);
        if (first >= 0) {
            setRankStart(first);
            setRankEnd(last + 1);
        }
    };

    return (
        <div className="card glass">
            <div className="card-header">
                <div>
                    <h3>Web Crawler</h3>
                    <p>Fetch live match data from Riot API</p>
                </div>
                <Button onClick={handleCrawl} id="btn-crawl-toggle">
                    {isRunning ? '⏹ Stop Crawling' : '▶ Start Crawling'}
                </Button>
            </div>

            {/* Crawler Configuration — only show when NOT running */}
            {!isRunning && (
                <div className="crawler-config">
                    <div className="config-section">
                        <label className="config-label">Region</label>
                        <div className="config-row">
                            <select
                                id="select-region"
                                className="hex-select"
                                value={selectedRegion}
                                onChange={(e) => setSelectedRegion(e.target.value)}
                            >
                                <option value="all">🌍 All Regions (Global)</option>
                                {regions.map(r => (
                                    <option key={r.name} value={r.name}>
                                        {r.name} — {r.platforms.join(', ')}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="config-section">
                        <label className="config-label">Rank Range</label>
                        <div className="config-row rank-row">
                            <div className="rank-select-group">
                                <span className="rank-label">From</span>
                                <select
                                    id="select-rank-start"
                                    className="hex-select"
                                    value={rankStart}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setRankStart(val);
                                        if (val >= rankEnd) setRankEnd(val + 1);
                                    }}
                                >
                                    {ranks.map((r, i) => (
                                        <option key={`start-${i}`} value={i}>
                                            {r.tier} {r.division}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <span className="rank-arrow">→</span>
                            <div className="rank-select-group">
                                <span className="rank-label">To</span>
                                <select
                                    id="select-rank-end"
                                    className="hex-select"
                                    value={rankEnd}
                                    onChange={(e) => setRankEnd(parseInt(e.target.value))}
                                >
                                    {ranks.map((r, i) => {
                                        if (i < rankStart) return null;
                                        return (
                                            <option key={`end-${i}`} value={i + 1}>
                                                {r.tier} {r.division}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                        </div>
                        <div className="tier-quick-select">
                            <span className="quick-label">Quick:</span>
                            <button
                                className="tier-chip"
                                onClick={() => { setRankStart(0); setRankEnd(ranks.length); }}
                            >
                                Full Ladder
                            </button>
                            {tiers.map(t => (
                                <button
                                    key={t}
                                    className="tier-chip"
                                    onClick={() => handleTierQuickSelect(t)}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="config-section">
                        <label className="config-label">Patch Filter</label>
                        <div className="config-row">
                            <select
                                id="select-patch-filter"
                                className="hex-select"
                                value={strictPatch ? 'strict' : 'lenient'}
                                onChange={(e) => setStrictPatch(e.target.value === 'strict')}
                            >
                                <option value="strict">Strict (Current Patch Only)</option>
                                <option value="lenient">Lenient (Allow Previous Patch)</option>
                            </select>
                        </div>
                        {!strictPatch && (
                            <div className="config-alert">
                                ⚠️ <strong>Lenient Mode Active:</strong> Ensure you turn this back to Strict once the current patch has enough matches to keep your stats accurate.
                            </div>
                        )}
                    </div>

                    <div className="config-summary">
                        <span className="summary-icon">⚡</span>
                        <span>
                            {selectedRegion === 'all' ? 'Global' : selectedRegion} crawl
                            {' · '}
                            {getRankLabel(rankStart)} → {getRankLabel(Math.max(0, rankEnd - 1))}
                            {' · '}
                            {rankEnd - rankStart} rank{rankEnd - rankStart !== 1 ? 's' : ''}
                            {' · '}
                            {strictPatch ? 'Strict Patch' : 'Lenient Patch'}
                        </span>
                    </div>
                </div>
            )}

            {/* Progress bar — always visible */}
            <div className="progress-section">
                <div className="progress-header">
                    <span>{getRankText()}</span>
                    <span>{status ? `${status.currentMatches || 0} / 100` : '0 / 100'}</span>
                </div>
                <div className="progress-bar">
                    <div className="progress-fill" style={{ width: getProgressWidth() }}></div>
                </div>
            </div>
        </div>
    );
}

export default CrawlerPanel;
