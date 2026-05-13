import React from 'react';
import { Button } from 'react-hextech';
import { apiPost } from '../hooks/useApi';

const RANKS = [
    "IRON IV", "IRON III", "IRON II", "IRON I",
    "BRONZE IV", "BRONZE III", "BRONZE II", "BRONZE I",
    "SILVER IV", "SILVER III", "SILVER II", "SILVER I",
    "GOLD IV", "GOLD III", "GOLD II", "GOLD I",
    "PLATINUM IV", "PLATINUM III", "PLATINUM II", "PLATINUM I",
    "EMERALD IV", "EMERALD III", "EMERALD II", "EMERALD I",
    "DIAMOND IV", "DIAMOND III", "DIAMOND II", "DIAMOND I",
    "MASTER I", "GRANDMASTER I", "CHALLENGER I"
];

function CrawlerPanel({ isRunning, status, addLog }) {
    const handleCrawl = async () => {
        try {
            const { ok, data } = await apiPost(`/action/crawl/${isRunning ? 'stop' : 'start'}`);
            addLog(ok ? data.message : data.error, ok ? 'success' : 'error');
        } catch (err) {
            addLog(`Error: ${err.message}`, 'error');
        }
    };

    const getProgressWidth = () => {
        if (!status) return '0%';
        const current = status.currentMatches || 0;
        return `${Math.min(100, Math.floor((current / 100) * 100))}%`;
    };

    const getRankText = () => {
        if (!status || status.rankIndex === undefined) return 'Not Running';
        return `Rank: ${RANKS[status.rankIndex] || 'Unknown'}`;
    };

    return (
        <div className="card glass">
            <div className="card-header">
                <div>
                    <h3>Web Crawler</h3>
                    <p>Fetch live match data from Riot API</p>
                </div>
                <Button onClick={handleCrawl}>{isRunning ? 'Stop Crawling' : 'Start Crawling'}</Button>
            </div>

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
