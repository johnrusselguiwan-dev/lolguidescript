import React, { useState, useEffect, useRef } from 'react';
import { Button } from 'react-hextech';
import { apiGet, apiPost } from '../hooks/useApi';

function TeamDataPanel({ addLog, isUploading, setIsUploading, isMerging, setIsMerging }) {
    // DB Stats
    const [dbStats, setDbStats] = useState(null);

    // Export state
    const [isExporting, setIsExporting] = useState(false);
    const [exportResult, setExportResult] = useState(null);
    const [exportList, setExportList] = useState([]);

    // Import state
    const [importFiles, setImportFiles] = useState([]);
    const [mergeResult, setMergeResult] = useState(null);
    const [isDragOver, setIsDragOver] = useState(false);

    const fileInputRef = useRef(null);

    // Load data on mount
    useEffect(() => {
        loadDbStats();
        loadImportBin();
        loadExports();
    }, []);

    const loadDbStats = async () => {
        try {
            const { ok, data } = await apiGet('/data/db-stats');
            if (ok) setDbStats(data);
        } catch (e) {
            console.error('Failed to load DB stats:', e);
        }
    };

    const loadImportBin = async () => {
        try {
            const { ok, data } = await apiGet('/data/import/list');
            if (ok) setImportFiles(data.files || []);
        } catch (e) {
            console.error('Failed to load import bin:', e);
        }
    };

    const loadExports = async () => {
        try {
            const { ok, data } = await apiGet('/data/export/list');
            if (ok) setExportList(data.files || []);
        } catch (e) {
            console.error('Failed to load exports:', e);
        }
    };

    // ── Export Handlers ──────────────────────────────────────────────────

    const handleExport = async () => {
        if (isExporting || isUploading || isMerging) {
            alert('A background process is already running. Please wait for it to finish.');
            return;
        }
        setIsExporting(true);
        setExportResult(null);
        addLog('Exporting database...', 'info');
        try {
            const { ok, data } = await apiPost('/data/export');
            if (ok) {
                setExportResult(data);
                addLog(data.message, 'success');
                loadExports();
                loadDbStats();
            } else {
                addLog(data.error || 'Export failed', 'error');
            }
        } catch (e) {
            addLog(`Export error: ${e.message}`, 'error');
        }
        setIsExporting(false);
    };

    // ── Import Handlers ──────────────────────────────────────────────────

    const uploadFile = async (file) => {
        const formData = new FormData();
        formData.append('dbFile', file);

        const res = await fetch('/api/data/import/upload', {
            method: 'POST',
            body: formData
        });
        return res.json();
    };

    const handleFileDrop = async (e) => {
        e.preventDefault();
        setIsDragOver(false);

        if (isExporting || isUploading || isMerging) {
            alert('A background process is already running. Please wait for it to finish.');
            return;
        }

        const files = Array.from(e.dataTransfer?.files || []).filter(f => f.name.endsWith('.db'));
        if (files.length === 0) {
            addLog('Only .db files are accepted', 'error');
            return;
        }

        setIsUploading(true);
        for (const file of files) {
            addLog(`Uploading ${file.name}...`, 'info');
            try {
                const result = await uploadFile(file);
                addLog(result.message || `Uploaded ${file.name}`, 'success');
            } catch (e) {
                addLog(`Failed to upload ${file.name}: ${e.message}`, 'error');
            }
        }
        setIsUploading(false);
        loadImportBin();
    };

    const handleFileSelect = async (e) => {
        if (isExporting || isUploading || isMerging) {
            alert('A background process is already running. Please wait for it to finish.');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        const files = Array.from(e.target.files || []).filter(f => f.name.endsWith('.db'));
        if (files.length === 0) return;

        setIsUploading(true);
        for (const file of files) {
            addLog(`Uploading ${file.name}...`, 'info');
            try {
                const result = await uploadFile(file);
                addLog(result.message || `Uploaded ${file.name}`, 'success');
            } catch (e) {
                addLog(`Failed to upload ${file.name}: ${e.message}`, 'error');
            }
        }
        setIsUploading(false);
        loadImportBin();
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleMergeAll = async () => {
        if (isExporting || isUploading || isMerging) {
            alert('A background process is already running. Please wait for it to finish.');
            return;
        }
        setIsMerging(true);
        setMergeResult(null);
        addLog('Starting batch merge of import bin...', 'info');
        try {
            const { ok, data } = await apiPost('/data/import/run', { deleteAfterImport: true });
            if (ok) {
                setMergeResult(data);
                addLog(data.message, 'success');
                loadImportBin();
                loadDbStats();
            } else {
                addLog(data.error || 'Merge failed', 'error');
            }
        } catch (e) {
            addLog(`Merge error: ${e.message}`, 'error');
        }
        setIsMerging(false);
    };

    const handleRemoveFile = async (fileName) => {
        try {
            const res = await fetch(`/api/data/import/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
            const contentType = res.headers.get("content-type");
            let errorMsg = "";
            if (contentType && contentType.includes("application/json")) {
                const data = await res.json();
                if (res.ok) {
                    addLog(data.message || `Removed ${fileName}`, 'info');
                    loadImportBin();
                    return;
                }
                errorMsg = data.error || data.message;
            } else {
                const text = await res.text();
                errorMsg = text.replace(/<[^>]*>/g, '').trim().substring(0, 100);
            }
            throw new Error(errorMsg || `Server returned status ${res.status}`);
        } catch (e) {
            addLog(`Failed to remove ${fileName}: ${e.message}`, 'error');
        }
    };

    const handleRemoveExport = async (fileName) => {
        try {
            const res = await fetch(`/api/data/export/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
            const contentType = res.headers.get("content-type");
            let errorMsg = "";
            if (contentType && contentType.includes("application/json")) {
                const data = await res.json();
                if (res.ok) {
                    addLog(data.message || `Removed export ${fileName}`, 'info');
                    loadExports();
                    loadDbStats();
                    return;
                }
                errorMsg = data.error || data.message;
            } else {
                const text = await res.text();
                errorMsg = text.replace(/<[^>]*>/g, '').trim().substring(0, 100);
            }
            throw new Error(errorMsg || `Server returned status ${res.status}`);
        } catch (e) {
            addLog(`Failed to remove export ${fileName}: ${e.message}`, 'error');
        }
    };

    // ── Render ───────────────────────────────────────────────────────────

    return (
        <div className="tab-content" id="tab-teamdata">
            {/* DB Stats Bar */}
            {dbStats && (
                <div className="db-stats-bar">
                    <div className="stat-item">
                        <span className="stat-value">{dbStats.totalMatches.toLocaleString()}</span>
                        <span className="stat-label">Total Matches</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">{dbStats.sizeMB} MB</span>
                        <span className="stat-label">Database Size</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">{dbStats.patches?.length || 0}</span>
                        <span className="stat-label">Patches</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">{dbStats.regions?.length || 0}</span>
                        <span className="stat-label">Regions</span>
                    </div>
                    {dbStats.regions?.length > 0 && (
                        <div className="stat-item stat-regions">
                            <div className="region-chips">
                                {dbStats.regions.map(r => (
                                    <span key={r.region} className="region-chip">
                                        {r.region || 'unknown'}: {r.count.toLocaleString()}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="team-data-grid">
                {/* ── Export Section ───────────────────────────────────── */}
                <div className="card glass team-section">
                    <div className="team-section-header">
                        <div className="team-section-icon">📤</div>
                        <div>
                            <h3>Export My Data</h3>
                            <p>Package your crawled matches for sharing with the Master laptop</p>
                        </div>
                    </div>

                    <div className="team-section-body">
                        <Button
                            onClick={handleExport}
                            disabled={isExporting}
                            id="btn-export-db"
                        >
                            {isExporting ? '⏳ Exporting...' : '📤 Export Database'}
                        </Button>

                        {exportResult && (
                            <div className="export-result">
                                <span className="export-result-icon">✅</span>
                                <div>
                                    <strong>{exportResult.fileName}</strong>
                                    <span className="export-size">{exportResult.sizeMB} MB</span>
                                </div>
                                <a
                                    href={exportResult.downloadUrl}
                                    download
                                    className="download-link"
                                >
                                    ⬇ Download
                                </a>
                            </div>
                        )}

                        {exportList.length > 0 && (
                            <div className="file-list">
                                <div className="file-list-header">Previous Exports</div>
                                {exportList.map(f => (
                                    <div key={f.fileName} className="file-list-item">
                                        <span className="file-icon">💾</span>
                                        <span className="file-name">{f.fileName}</span>
                                        <span className="file-size">{f.sizeMB} MB</span>
                                        <a
                                            href={`/api/data/exports/${f.fileName}`}
                                            download
                                            className="download-link-sm"
                                            title="Download export"
                                        >
                                            ⬇
                                        </a>
                                        <button
                                            className="file-remove"
                                            onClick={(e) => { e.stopPropagation(); handleRemoveExport(f.fileName); }}
                                            title="Remove export"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Import Section ───────────────────────────────────── */}
                <div className="card glass team-section">
                    <div className="team-section-header">
                        <div className="team-section-icon">📥</div>
                        <div>
                            <h3>Import Team Data</h3>
                            <p>Drop worker .db files here to merge into your master database</p>
                        </div>
                    </div>

                    <div className="team-section-body">
                        {/* Drop Zone */}
                        <div
                            className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${isUploading ? 'uploading' : ''}`}
                            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                            onDragLeave={() => setIsDragOver(false)}
                            onDrop={handleFileDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".db"
                                multiple
                                onChange={handleFileSelect}
                                style={{ display: 'none' }}
                            />
                            {isUploading ? (
                                <>
                                    <div className="drop-icon">⏳</div>
                                    <div className="drop-text">Uploading...</div>
                                </>
                            ) : (
                                <>
                                    <div className="drop-icon">📂</div>
                                    <div className="drop-text">Drag & drop .db files here</div>
                                    <div className="drop-subtext">or click to browse</div>
                                </>
                            )}
                        </div>

                        {/* Import Bin File List */}
                        {importFiles.length > 0 && (
                            <div className="file-list">
                                <div className="file-list-header">
                                    Import Bin ({importFiles.length} file{importFiles.length !== 1 ? 's' : ''})
                                </div>
                                {importFiles.map(f => (
                                    <div key={f.fileName} className="file-list-item">
                                        <span className="file-icon">📄</span>
                                        <span className="file-name">{f.fileName}</span>
                                        <span className="file-size">{f.sizeMB} MB</span>
                                        <button
                                            className="file-remove"
                                            onClick={(e) => { e.stopPropagation(); handleRemoveFile(f.fileName); }}
                                            title="Remove from bin"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}

                                <Button
                                    onClick={handleMergeAll}
                                    disabled={isMerging}
                                    id="btn-merge-all"
                                >
                                    {isMerging ? '⏳ Merging...' : `🔄 Merge All (${importFiles.length} files)`}
                                </Button>
                            </div>
                        )}

                        {/* Merge Results */}
                        {mergeResult && mergeResult.results && (
                            <div className="merge-results">
                                <div className="merge-results-header">
                                    ✅ Merge Complete — {mergeResult.totalNew} new matches
                                </div>
                                {mergeResult.results.map((r, i) => (
                                    <div key={i} className="merge-result-item">
                                        <span className="file-name">{r.fileName}</span>
                                        <span className={`merge-count ${r.newMatches > 0 ? 'has-new' : ''}`}>
                                            +{r.newMatches} new / {r.totalIncoming} total
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TeamDataPanel;
