import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const CACHE_KEY = '@ushki_availability_cache_v5';
const CACHE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
const MAX_POOL_SIZE = 15;
const CONCURRENCY = 2;
const CHECK_TIMEOUT = 5000;

class AvailabilityService {
    constructor() {
        this.cache = new Map(); // url -> { status: 'unknown' | 'online' | 'offline', timestamp: number }
        this.highPriority = []; // Viewable stations (Queue)
        this.activeChecks = new Map(); // url -> cancelFunction
        this.listeners = new Set();
        this.isChecking = false;

        // Initialize Web Worker if on Web
        if (Platform.OS === 'web') {
            try {
                // Inline worker to avoid MIME type issues
                const workerCode = `
const activeRequests = new Map();

self.onmessage = async (e) => {
    const { id, url, type } = e.data;

    if (type === 'cancel') {
        const controller = activeRequests.get(id);
        if (controller) {
            controller.abort();
            activeRequests.delete(id);
        }
        return;
    }

    if (type === 'check') {
        const controller = new AbortController();
        activeRequests.set(id, controller);
        const signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(url, {
                method: 'GET',
                cache: 'no-store',
                signal: signal
            });

            activeRequests.delete(id);
            clearTimeout(timeoutId);
            
            if (response.ok || response.status === 200) {
                self.postMessage({ id, status: 'online', url });
            } else {
                self.postMessage({ id, status: 'offline', url });
            }
        } catch (error) {
            clearTimeout(timeoutId);
            activeRequests.delete(id);
            self.postMessage({ id, status: 'offline', url });
        }
    }
};
`;
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);
                this.worker = new Worker(workerUrl);

                this.workerIds = new Map(); // id -> { resolve, url }
                this.nextWorkerId = 1;

                this.worker.onmessage = (e) => {
                    const { id, status } = e.data;
                    const request = this.workerIds.get(id);
                    if (request) {
                        request.resolve({ status });
                        this.workerIds.delete(id);
                    }
                };
            } catch (e) {
                console.error('[AvailabilityService] Failed to initialize Web Worker', e);
            }
        }

        this.loadCache();
    }

    async loadCache() {
        try {
            const stored = await AsyncStorage.getItem(CACHE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                const now = Date.now();
                Object.entries(parsed).forEach(([url, data]) => {
                    if (now - data.timestamp < CACHE_TIMEOUT) {
                        this.cache.set(url, data);
                    }
                });
                this.notify();
            }
        } catch (e) {
            console.error('Failed to load availability cache', e);
        }
    }

    async saveCache() {
        try {
            const obj = Object.fromEntries(this.cache);
            await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(obj));
        } catch (e) {
            // Ignore storage errors
        }
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notify() {
        this.listeners.forEach(cb => cb());
    }

    getStatus(url) {
        if (!url) return 'unknown';
        return this.cache.get(url)?.status || 'unknown';
    }

    updateViewableStations(stations) {
        if (!stations || stations.length === 0) return;

        let urls = stations.map(s => s.url_resolved || s.url).filter(url => !!url);
        if (urls.length === 0) return;

        if (urls.length > MAX_POOL_SIZE) {
            urls = urls.slice(0, MAX_POOL_SIZE);
        }

        const urlSet = new Set(urls);

        // Cancel active checks that are NOT in the new viewable list
        for (const [url, cancel] of this.activeChecks) {
            if (!urlSet.has(url)) {
                cancel();
                this.activeChecks.delete(url);
            }
        }

        const now = Date.now();

        // Filter out stations that are recently cached
        const toCheck = urls.filter(url => {
            const cached = this.cache.get(url);
            if (!cached) return true;
            if (now - cached.timestamp > CACHE_TIMEOUT) return true;
            return false;
        });

        this.highPriority = [...new Set(toCheck)];

        if (this.highPriority.length > 0 && !this.isChecking) {
            this.processPool();
        }
    }

    async processPool() {
        if (this.isChecking) return;
        this.isChecking = true;

        const worker = async (id) => {
            while (true) {
                let url = null;
                if (this.highPriority.length > 0) {
                    url = this.highPriority.shift();
                } else {
                    break;
                }

                if (!url) break;

                const cached = this.cache.get(url);
                if (cached && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
                    continue;
                }

                await this.performCheck(url);
                this.notify();
            }
        };

        try {
            const workers = [];
            for (let i = 0; i < CONCURRENCY; i++) {
                workers.push(worker(i));
            }
            await Promise.all(workers);
        } finally {
            this.isChecking = false;
            this.saveCache();
        }
    }

    performCheck(url) {
        return new Promise(async (resolve) => {
            let cancelled = false;

            const finish = (status) => {
                if (cancelled) return;
                this.cache.set(url, {
                    status: status,
                    timestamp: Date.now()
                });
                this.activeChecks.delete(url);
                resolve();
            };

            this.activeChecks.set(url, () => {
                cancelled = true;
                resolve(); 
            });

            try {
                if (Platform.OS === 'web') {
                    if (this.worker) {
                        const id = this.nextWorkerId++;
                        this.workerIds.set(id, {
                            resolve: (res) => {
                                finish(res.status);
                            }, url
                        });

                        const originalCancel = this.activeChecks.get(url);
                        this.activeChecks.set(url, () => {
                            this.worker.postMessage({ type: 'cancel', id, url });
                            if (originalCancel) originalCancel();
                            this.workerIds.delete(id);
                        });

                        this.worker.postMessage({ type: 'check', id, url });
                    } else {
                        finish('offline');
                    }
                    return;
                }

                // Native check using fetch
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT);

                    const response = await fetch(url, {
                        method: 'GET',
                        cache: 'no-store',
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);

                    if (response.ok || response.status === 200) {
                        finish('online');
                    } else {
                        finish('offline');
                    }
                } catch (e) {
                    finish('offline');
                }
            } catch (e) {
                finish('offline');
            }
        });
    }
}

export default new AvailabilityService();
