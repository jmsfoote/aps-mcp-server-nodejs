// In-memory preview store for the bulk-import preview/commit flow.
// First cut keeps it process-local — Supabase-backed persistence is deferred
// per the spec until we have evidence that cross-process state is needed.
//
// Per-entry TTL is 10 min (600s) — same default as the spec.

const TTL_MS = 10 * 60 * 1000;
const entries = new Map();

export const previewStore = {
    /**
     * Store a payload under previewId. Returns the TTL in seconds.
     */
    set(previewId, payload) {
        entries.set(previewId, { payload, expiresAt: Date.now() + TTL_MS });
        return TTL_MS / 1000;
    },

    /**
     * Get a payload by previewId. Returns null if not found or expired.
     * Expired entries are auto-purged on read.
     */
    get(previewId) {
        const entry = entries.get(previewId);
        if (!entry) return null;
        if (entry.expiresAt < Date.now()) {
            entries.delete(previewId);
            return null;
        }
        return entry.payload;
    },

    /**
     * Delete an entry (called after a successful commit).
     */
    delete(previewId) {
        entries.delete(previewId);
    },

    /**
     * For tests/debugging only.
     */
    _size() {
        return entries.size;
    },
};
