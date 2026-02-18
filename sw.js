var TILE_CACHE = 'trip2rome-tiles';
var CDN_CACHE = 'trip2rome-cdn';

// Install: activate immediately, no app shell caching
self.addEventListener('install', function (event) {
    self.skipWaiting();
});

// Activate: clean up any old app shell caches from previous versions
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) {
                    return k !== TILE_CACHE && k !== CDN_CACHE;
                }).map(function (k) {
                    return caches.delete(k);
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch: only intercept tiles and CDN — let app files go straight to network
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
            caches.open(CDN_CACHE).then(function (cache) {
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

    // Everything else (app files): pass through to network, no caching
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

    function downloadNext(index) {
        if (index >= tiles.length) {
            notifyClients({ type: 'DOWNLOAD_COMPLETE', total: total });
            return;
        }

        caches.open(TILE_CACHE).then(function (cache) {
            cache.match(tiles[index]).then(function (cached) {
                if (cached) {
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
