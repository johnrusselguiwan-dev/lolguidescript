import React, { useState, useEffect } from 'react';

function PatchCountdown() {
    const [timeLeft, setTimeLeft] = useState('');
    const [nextPatchDateStr, setNextPatchDateStr] = useState('');

    useEffect(() => {
        // Base anchor: Wednesday, May 27, 2026 12:00:00 GMT
        // This is a known patch date (e.g., 16.11). Patches are usually every 14 days.
        const anchorDate = new Date('2026-05-27T12:00:00Z').getTime();
        const cycleDuration = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds

        const calculateTimeLeft = () => {
            const now = new Date().getTime();
            
            // Calculate how many full 14-day cycles have passed since the anchor
            const timeSinceAnchor = now - anchorDate;
            const cyclesPassed = Math.floor(timeSinceAnchor / cycleDuration);
            
            // The next patch date is the start of the next cycle
            const nextPatchDate = anchorDate + ((cyclesPassed + 1) * cycleDuration);
            
            const difference = nextPatchDate - now;

            if (difference > 0) {
                const days = Math.floor(difference / (1000 * 60 * 60 * 24));
                const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
                
                setTimeLeft(`${days}d ${hours}h ${minutes}m`);
                
                // Format the next patch date nicely
                const nextDateObj = new Date(nextPatchDate);
                setNextPatchDateStr(nextDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
            } else {
                setTimeLeft('Patching soon!');
            }
        };

        calculateTimeLeft();
        const timer = setInterval(calculateTimeLeft, 60000); // Update every minute

        return () => clearInterval(timer);
    }, []);

    return (
        <div className="patch-countdown" style={{
            marginTop: 'auto',
            padding: '16px',
            background: 'rgba(200, 155, 60, 0.1)',
            borderTop: '1px solid rgba(200, 155, 60, 0.3)',
            color: '#a09b8c',
            textAlign: 'center',
            fontSize: '0.9rem'
        }}>
            <div style={{ color: '#f0e6d2', fontWeight: 'bold', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="icon">⏱️</span> Next Patch
            </div>
            <div style={{ color: '#c89b3c', fontSize: '1.1rem', fontWeight: 'bold', margin: '4px 0' }}>
                {timeLeft}
            </div>
            <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                Expected: {nextPatchDateStr}
            </div>
        </div>
    );
}

export default PatchCountdown;
