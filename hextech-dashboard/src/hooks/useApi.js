/**
 * Custom hook for API interactions with the backend.
 * Centralizes all fetch calls so components stay clean.
 */

const API_BASE = '/api';

export async function apiPost(endpoint) {
    const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST' });
    const data = await res.json();
    return { ok: res.ok, data };
}

export async function apiPostJson(endpoint, body) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    return { ok: res.ok, data };
}

export async function apiGet(endpoint) {
    const res = await fetch(`${API_BASE}${endpoint}`);
    const data = await res.json();
    return { ok: res.ok, data };
}
