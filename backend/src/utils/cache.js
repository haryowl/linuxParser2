// backend/src/utils/cache.js
const logger = require('./logger');

class SimpleCache {
    constructor(defaultTTL = 60000) { // Default 60 seconds
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
    }
    
    set(key, value, ttl = this.defaultTTL) {
        const expiresAt = Date.now() + ttl;
        this.cache.set(key, { value, expiresAt });
    }
    
    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            return null;
        }
        
        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        
        return item.value;
    }
    
    delete(key) {
        this.cache.delete(key);
    }
    
    clear() {
        this.cache.clear();
    }

    getStats() {
        const now = Date.now();
        let activeEntries = 0;
        let expiredEntries = 0;

        for (const [, item] of this.cache.entries()) {
            if (now > item.expiresAt) {
                expiredEntries += 1;
            } else {
                activeEntries += 1;
            }
        }

        return {
            totalEntries: this.cache.size,
            activeEntries,
            expiredEntries,
            defaultTTLms: this.defaultTTL
        };
    }
    
    // Clean expired entries
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiresAt) {
                this.cache.delete(key);
            }
        }
    }
}

// Create singleton cache instance
const cache = new SimpleCache(60000); // 60 second TTL

// Cleanup expired entries every 5 minutes
setInterval(() => {
    cache.cleanup();
}, 5 * 60 * 1000);

module.exports = cache;

