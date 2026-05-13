import React, { useState } from 'react';
import { Button } from 'react-hextech';
import { apiPostJson } from '../hooks/useApi';

function ApiKeyForm() {
    const [apiKey, setApiKey] = useState('');
    const [status, setStatus] = useState('');

    const handleUpdate = async () => {
        setStatus('Updating...');
        try {
            const { ok, data } = await apiPostJson('/settings/apikey', { apiKey });
            if (ok) {
                setStatus('Success!');
                setApiKey('');
                setTimeout(() => setStatus(''), 3000);
            } else {
                setStatus('Error: ' + data.error);
            }
        } catch {
            setStatus('Error updating key.');
        }
    };

    return (
        <div className="card glass" style={{ marginBottom: '24px' }}>
            <div className="card-header">
                <div>
                    <h3>API Configuration</h3>
                    <p>Update your Riot Developer API Key (.env)</p>
                </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    style={{
                        flex: 1, padding: '10px 14px', background: 'rgba(0,0,0,0.5)',
                        border: '1px solid #785a28', color: '#f0e6d2', borderRadius: '4px',
                        fontFamily: 'monospace'
                    }}
                />
                <Button onClick={handleUpdate}>Update Key</Button>
                {status && <span style={{ color: '#c8aa6e', fontSize: '0.9rem' }}>{status}</span>}
            </div>
        </div>
    );
}

export default ApiKeyForm;
