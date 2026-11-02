/**
 * AkiCrop – Minimal service worker for offline caching (optional for Add to Home Screen).
 */
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { resolve } from '$app/paths';

const CACHE = `akicrop-${version}`;

// `immutable`/`assets` paths are relative to the base path — resolve to absolute pathnames
const ASSETS = [
	...immutable.map((file) => resolve(file.path)),
	...assets.map((file) => resolve(file.path))
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
	);
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
		)
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	event.respondWith(
		(async () => {
			const url = new URL(event.request.url);
			const cache = await caches.open(CACHE);

			if (ASSETS.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			try {
				const response = await fetch(event.request);
				if (response.status === 200 && !response.headers.get('cache-control')?.includes('no-store')) {
					void cache.put(event.request, response.clone());
				}
				return response;
			} catch {
				const cached = await cache.match(event.request);
				if (cached) return cached;
				throw new Error(`Network error and no cached response for ${event.request.url}`);
			}
		})()
	);
});
