import React, { useEffect, useRef } from 'react';

function LogViewer({ logs }) {
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (logsEndRef.current) {
            const parent = logsEndRef.current.parentElement;
            if (parent) {
                parent.scrollTo({
                    top: parent.scrollHeight,
                    behavior: 'smooth'
                });
            }
        }
    }, [logs]);

    return (
        <div className="logger glass">
            <div className="logger-header">
                System Logs
                <span className="info-icon" title="Live system events, errors, and crawler activity.">i</span>
            </div>
            <div className="logger-body">
                {logs.map((log, i) => (
                    <div key={i} className={`log-entry ${log.type}`}>
                        {log.type === 'error' && (
                            <img src="/poro-error.png" alt="Error" className="poro-error-icon" />
                        )}
                        <span>{log.msg}</span>
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    );
}

export default LogViewer;
