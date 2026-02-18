var CACHE_NAME = 'trip2rome-v6';
var TILE_CACHE = 'trip2rome-tiles';

var APP_SHELL = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './manifest.json',
    './icons/icon.svg'
];

// Install: cache app shell
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(APP_SHELL);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches and force-reload all clients
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) {
                    return k !== CACHE_NAME && k !== TILE_CACHE;
                }).map(function (k) {
                    return caches.delete(k);
                })
            );
        }).then(function () {
            // After cleaning caches, reload all open tabs so they get fresh assets
            return self.clients.matchAll({ type: 'window' }).then(function (clients) {
                clients.forEach(function (client) {
                    client.navigate(client.url);
                });
            });
        })
    );
    self.clients.claim();
});

// Fetch: cache-first for tiles & CDN, network-first for app
self.addEventListener('fetch', function (event) {
    var url = new URL(event.request.url);

    // Map tiles: cache-first (works offline)
    if (url.hostname === 'tile.openstreetmap.org') {
        event.respondWith(
            caches.open(TILE_CACHE).then(function (cache) {
                return cache.match(event.request).then(function (cached) {
                    if (cached) return cached;
                    return fetch(event.request).then(function (response) {
                        if (response.ok) {
                            cache.put(event.request, response.clone());
                        }
                        return response;
                    }).catch(function () {
                        // Return a transparent 1x1 PNG if offline and tile not cached
                        return new Response(
                            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
                            { headers: { 'Content-Type': 'image/png' } }
                        );
                    });
                });
            })
        );
        return;
    }

    // CDN resources (Leaflet): cache-first
    if (url.hostname === 'unpkg.com') {
        event.respondWith(
            caches.open(CACHE_NAME).then(function (cache) {
                return cache.match(event.request).then(function (cached) {
                    if (cached) return cached;
                    return fetch(event.request).then(function (response) {
                        if (response.ok) {
                            cache.put(event.request, response.clone());
                        }
                        return response;
                    });
                });
            })
        );
        return;
    }

    // App files: network-first, fallback to cache
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(event.request).then(function (response) {
                if (response.ok) {
                    var responseClone = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            }).catch(function () {
                return caches.match(event.request);
            })
        );
        return;
    }
});

// Message handler: tile pre-download
self.addEventListener('message', function (event) {
    if (event.data.type === 'DOWNLOAD_TILES') {
        downloadTiles(event.data.bounds, event.data.minZoom, event.data.maxZoom);
    }
});

function downloadTiles(bounds, minZoom, maxZoom) {
    var tiles = [];

    for (var z = minZoom; z <= maxZoom; z++) {
        var minTile = latLngToTile(bounds.south, bounds.west, z);
        var maxTile = latLngToTile(bounds.north, bounds.east, z);

        for (var x = Math.min(minTile.x, maxTile.x); x <= Math.max(minTile.x, maxTile.x); x++) {
            for (var y = Math.min(minTile.y, maxTile.y); y <= Math.max(minTile.y, maxTile.y); y++) {
                tiles.push('https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png');
            }
        }
    }

    var downloaded = 0;
    var total = tiles.length;

    // Download sequentially with rate limiting (respect OSM tile policy: max 2/sec)
    function downloadNext(index) {
        if (index >= tiles.length) {
            notifyClients({ type: 'DOWNLOAD_COMPLETE', total: total });
            return;
        }

        caches.open(TILE_CACHE).then(function (cache) {
            cache.match(tiles[index]).then(function (cached) {
                if (cached) {
                    // Already cached, skip
                    downloaded++;
                    notifyClients({ type: 'DOWNLOAD_PROGRESS', downloaded: downloaded, total: total });
                    downloadNext(index + 1);
                } else {
                    fetch(tiles[index]).then(function (response) {
                        if (response.ok) {
                            cache.put(tiles[index], response);
                        }
                        downloaded++;
                        notifyClients({ type: 'DOWNLOAD_PROGRESS', downloaded: downloaded, total: total });
                        // Rate limit: 500ms between requests
                        setTimeout(function () { downloadNext(index + 1); }, 500);
                    }).catch(function () {
                        downloaded++;
                        notifyClients({ type: 'DOWNLOAD_PROGRESS', downloaded: downloaded, total: total });
                        setTimeout(function () { downloadNext(index + 1); }, 500);
                    });
                }
            });
        });
    }

    downloadNext(0);
}

function latLngToTile(lat, lng, zoom) {
    var n = Math.pow(2, zoom);
    var x = Math.floor((lng + 180) / 360 * n);
    var latRad = lat * Math.PI / 180;
    var y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x: x, y: y };
}

function notifyClients(msg) {
    self.clients.matchAll().then(function (clients) {
        clients.forEach(function (client) {
            client.postMessage(msg);
        });
    });
}
