// ============================================================
// offline-queue.js  –  Morouj Plant PWA  •  Offline Submit Queue
//
// Architecture:
//   • IndexedDB store "morouj-offline-queue / pending_requests"
//     persists every failed form submission across page reloads.
//   • Three triggers replay the queue:
//       1.  window 'online' event  (immediate on reconnect)
//       2.  ServiceWorker Background Sync  (even when tab closed)
//       3.  setInterval every 30 s  (safety net)
//   • window.OfflineQueue is the public API consumed by app.js.
// ============================================================
;(function () {
    'use strict';

    const DB_NAME    = 'morouj-offline-queue';
    const DB_VERSION = 1;
    const STORE      = 'pending_requests';
    const SYNC_TAG   = 'morouj-offline-sync';

    // ── IndexedDB helpers ─────────────────────────────────────
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror   = (e) => reject(e.target.error);
        });
    }

    async function dbAdd(record) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE, 'readwrite');
            const req = tx.objectStore(STORE).add(record);
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }

    async function dbGetAll() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }

    async function dbDelete(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE, 'readwrite');
            const req = tx.objectStore(STORE).delete(id);
            req.onsuccess = () => resolve();
            req.onerror   = () => reject(req.error);
        });
    }

    async function dbCount() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).count();
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }

    // ── Enqueue a failed request ──────────────────────────────
    async function enqueue({ endpoint, method = 'POST', headers, body, label }) {
        await dbAdd({
            endpoint,
            method,
            headers,
            body,
            label: label || endpoint,
            queuedAt: new Date().toISOString(),
        });
        await updateBadge();
        // Register a background sync so the SW can wake us up later
        _registerSync();
    }

    // ── Flush: replay every queued request ───────────────────
    let _flushing = false;
    async function flush() {
        if (_flushing) return;          // prevent concurrent runs
        _flushing = true;

        let records;
        try {
            records = await dbGetAll();
        } catch (err) {
            _flushing = false;
            return;
        }

        if (records.length === 0) {
            _flushing = false;
            return;
        }

        console.log(`[OfflineQueue] Flushing ${records.length} queued record(s)…`);

        let ok = 0, fail = 0;

        for (const record of records) {
            try {
                const res = await fetch(record.endpoint, {
                    method:  record.method,
                    headers: record.headers,
                    body:    record.body,
                });

                if (res.ok) {
                    await dbDelete(record.id);
                    ok++;
                    console.log(`[OfflineQueue] ✓ Uploaded: ${record.label}`);
                } else if (res.status >= 400 && res.status < 500) {
                    // 4xx = server will never accept it; remove to avoid infinite loop
                    await dbDelete(record.id);
                    console.warn(`[OfflineQueue] Removed (${res.status}): ${record.label}`);
                    fail++;
                } else {
                    // 5xx = transient, keep for retry
                    fail++;
                }
            } catch (netErr) {
                // Network still down – keep in queue
                fail++;
                console.warn(`[OfflineQueue] Still offline for: ${record.label}`);
            }
        }

        await updateBadge();
        _flushing = false;

        // Refresh the recent submissions list in the operator view
        if (ok > 0 && typeof loadRecentSubmissionsForOperator === 'function') {
            loadRecentSubmissionsForOperator();
        }

        // User-facing result toast
        if (ok > 0 && fail === 0) {
            _toast(`📡 Back online! ${ok} saved reading${ok > 1 ? 's' : ''} uploaded successfully.`, false);
        } else if (ok > 0) {
            _toast(`📡 Uploaded ${ok} reading${ok > 1 ? 's' : ''}. ${fail} still pending.`, true);
        } else if (fail > 0) {
            _toast(`⚠️ Still offline — ${fail} reading${fail > 1 ? 's' : ''} queued locally.`, true);
        }
    }

    // ── Header badge (count of pending items) ────────────────
    async function updateBadge() {
        const n     = await dbCount();
        const badge = document.getElementById('offline-queue-badge');
        const btn   = document.getElementById('offline-queue-btn');
        if (badge) {
            badge.textContent = n;
            badge.classList.toggle('hidden', n === 0);
        }
        // Show the whole button only when there are queued items
        if (btn) btn.classList.toggle('hidden', n === 0);
    }

    // ── Internal: call app.js showToast if available ──────────
    function _toast(msg, isError) {
        if (typeof showToast === 'function') {
            showToast(msg, isError);
        } else {
            alert(msg);
        }
    }

    // ── Background Sync registration ──────────────────────────
    async function _registerSync() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            if ('sync' in reg) {
                await reg.sync.register(SYNC_TAG);
            }
        } catch (_) { /* Background Sync not available in this browser */ }
    }

    // ── SW message relay (Background Sync fires → SW pings us) ─
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (e) => {
            if (e.data?.type === 'SYNC_OFFLINE_QUEUE') {
                console.log('[OfflineQueue] Background sync triggered by SW');
                flush();
            }
        });
    }

    // ── Trigger 1: browser comes back online ─────────────────
    window.addEventListener('online', () => {
        console.log('[OfflineQueue] Network restored – flushing queue…');
        flush();
    });

    // ── Trigger 2: 30-second safety-net poll ─────────────────
    setInterval(async () => {
        if (!navigator.onLine) return;
        const n = await dbCount();
        if (n > 0) {
            console.log('[OfflineQueue] Periodic flush check…');
            flush();
        }
    }, 30_000);

    // ── Public API ────────────────────────────────────────────
    window.OfflineQueue = { enqueue, flush, getCount: dbCount, updateBadge };

    // Initialise badge on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateBadge);
    } else {
        updateBadge();
    }
})();
