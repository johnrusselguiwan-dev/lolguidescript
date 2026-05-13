import React, { useEffect, useRef } from 'react';

function LogViewer({ logs }) {
    const logsEndRef = useRef(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="logger glass">
            <div className="logger-header">System Logs</div>
            <div className="logger-body">
                {logs.map((log, i) => (
                    <div key={i} className={`log-entry ${log.type}`}>{log.msg}</div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    );
}

export default LogViewer;
