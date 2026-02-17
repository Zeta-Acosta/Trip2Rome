(function () {
    'use strict';

    // =========================================================================
    // Configuration
    // =========================================================================
    var ROME_CENTER = [41.9028, 12.4964];
    var DEFAULT_ZOOM = 13;
    var STORAGE_KEY = 'trip2rome_locations';
    var AI_KEY_STORAGE = 'trip2rome_ai_key';
    var AI_PROVIDER_STORAGE = 'trip2rome_ai_provider';

    var CATEGORIES = {
        accommodation: { label: 'Stay',       color: '#1565C0', icon: '\u{1F3E0}' },
        landmark:      { label: 'Sights',     color: '#EF6C00', icon: '\u{1F3DB}' },
        food:          { label: 'Food',       color: '#C62828', icon: '\u{1F37D}' },
        entertainment: { label: 'Fun',        color: '#7B1FA2', icon: '\u{1F3AE}' },
        shopping:      { label: 'Shopping',   color: '#2E7D32', icon: '\u{1F6CD}' },
        custom:        { label: 'Other',      color: '#546E7A', icon: '\u{1F4CD}' }
    };

    var DEFAULT_LOCATIONS = [
        {
            id: 'loc_bb',
            name: 'Our B&B',
            category: 'accommodation',
            lat: 41.8972,
            lng: 12.5030,
            address: 'Via Filippo Turati, 129, 00185 Roma RM',
            notes: 'Home base!',
            date: '',
            time: ''
        },
        {
            id: 'loc_trevi',
            name: 'Trevi Fountain',
            category: 'landmark',
            lat: 41.9009,
            lng: 12.4833,
            address: 'Piazza di Trevi, 00187 Roma RM',
            notes: 'Throw a coin! Best visited early morning or late evening.',
            date: '',
            time: ''
        },
        {
            id: 'loc_colosseum',
            name: 'Colosseum',
            category: 'landmark',
            lat: 41.8902,
            lng: 12.4922,
            address: 'Piazza del Colosseo, 1, 00184 Roma RM',
            notes: 'Book tickets online in advance to skip the line!',
            date: '',
            time: ''
        },
        {
            id: 'loc_galbi',
            name: 'Galbi',
            category: 'food',
            lat: 41.9240,
            lng: 12.5110,
            address: 'Via Cremera, 21, Roma',
            notes: '',
            date: '',
            time: ''
        },
        {
            id: 'loc_vigamus',
            name: 'VIGAMUS - Video Game Museum',
            category: 'entertainment',
            lat: 41.9195,
            lng: 12.4670,
            address: 'Via Sabotino, 4A, 00195 Roma RM',
            notes: 'Video game museum - check opening hours!',
            date: '',
            time: ''
        }
    ];

    // =========================================================================
    // App State
    // =========================================================================
    var map;
    var markers = {};
    var locations = [];
    var activeFilters = {};
    var addMode = false;
    var editingId = null;
    var routeVisible = false;
    var routeLayer = null;
    var routeLabels = [];
    var selectedCategory = 'landmark';
    var tempMarker = null;
    var positionMarker = null;

    // AI state
    var aiImageData = null;
    var aiExtractedLocations = [];

    // Live tracking state
    var liveTracking = false;
    var watchId = null;
    var trackingLayer = null;
    var trackingDot = null;
    var trackingAccuracyCircle = null;
    var lastKnownPosition = null;
    var lastRenderedPosition = null;
    var lastRenderTimestamp = 0;
    var consecutiveErrors = 0;
    var hiddenTimestamp = 0;
    var autoStopTimer = null;
    var pendingPosition = null;
    var renderTimeoutId = null;
    var currentHighAccuracy = true;
    var stationaryCount = 0;
    var MAX_CONSECUTIVE_ERRORS = 5;
    var MIN_RENDER_INTERVAL = 1000;
    var MAX_HIDDEN_DURATION = 5 * 60 * 1000; // 5 minutes

    // Init all category filters as active
    Object.keys(CATEGORIES).forEach(function (k) { activeFilters[k] = true; });

    // =========================================================================
    // Initialization
    // =========================================================================
    function init() {
        initMap();
        loadLocations();
        renderAllMarkers();
        buildCategorySelector();
        buildFilterChips();
        setupEvents();
        registerSW();
        fitAllMarkers();
    }

    // =========================================================================
    // Map
    // =========================================================================
    function initMap() {
        map = L.map('map', {
            center: ROME_CENTER,
            zoom: DEFAULT_ZOOM,
            zoomControl: true,
            attributionControl: true
        });

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19
        }).addTo(map);

        map.on('click', onMapClick);
    }

    // =========================================================================
    // Location Data (CRUD)
    // =========================================================================
    function loadLocations() {
        var stored = null;
        try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { /* ignore */ }

        if (stored && stored.length) {
            locations = stored;
            // Merge any new defaults that don't exist yet
            DEFAULT_LOCATIONS.forEach(function (dl) {
                if (!locations.find(function (l) { return l.id === dl.id; })) {
                    locations.push(dl);
                }
            });
        } else {
            locations = DEFAULT_LOCATIONS.map(function (l) { return Object.assign({}, l); });
        }
        saveLocations();
    }

    function saveLocations() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(locations)); } catch (e) { /* ignore */ }
    }

    function getLocation(id) {
        return locations.find(function (l) { return l.id === id; });
    }

    function addLocation(loc) {
        locations.push(loc);
        saveLocations();
        addMarker(loc);
        if (routeVisible) drawRoute();
    }

    function updateLocation(id, data) {
        var idx = locations.findIndex(function (l) { return l.id === id; });
        if (idx === -1) return;
        Object.assign(locations[idx], data);
        saveLocations();
        removeMarker(id);
        addMarker(locations[idx]);
        if (routeVisible) drawRoute();
    }

    function deleteLocation(id) {
        locations = locations.filter(function (l) { return l.id !== id; });
        saveLocations();
        removeMarker(id);
        if (routeVisible) drawRoute();
    }

    // =========================================================================
    // Markers
    // =========================================================================
    function createMarkerIcon(category) {
        var cat = CATEGORIES[category] || CATEGORIES.custom;
        var html =
            '<div class="marker-pin">' +
            '  <div class="marker-pin-head" style="background:' + cat.color + '">' +
            '    <span class="marker-icon">' + cat.icon + '</span>' +
            '  </div>' +
            '  <div class="marker-pin-tail" style="border-top-color:' + cat.color + '"></div>' +
            '</div>';

        return L.divIcon({
            className: 'custom-marker',
            html: html,
            iconSize: [36, 44],
            iconAnchor: [18, 44],
            popupAnchor: [0, -44]
        });
    }

    function addMarker(loc) {
        if (!activeFilters[loc.category]) return;
        if (markers[loc.id]) return;

        var m = L.marker([loc.lat, loc.lng], { icon: createMarkerIcon(loc.category) });
        m.locationId = loc.id;
        m.addTo(map);
        m.on('click', function () { showDetail(loc.id); });

        markers[loc.id] = m;
    }

    function removeMarker(id) {
        if (markers[id]) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
    }

    function renderAllMarkers() {
        // Clear existing
        Object.keys(markers).forEach(function (id) {
            map.removeLayer(markers[id]);
        });
        markers = {};

        // Add filtered
        locations.forEach(function (loc) {
            if (activeFilters[loc.category]) {
                addMarker(loc);
            }
        });
    }

    function fitAllMarkers() {
        var visible = locations.filter(function (l) { return activeFilters[l.category]; });
        if (visible.length === 0) return;
        var bounds = L.latLngBounds(visible.map(function (l) { return [l.lat, l.lng]; }));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }

    // =========================================================================
    // Detail Sheet
    // =========================================================================
    function showDetail(id) {
        var loc = getLocation(id);
        if (!loc) return;

        var cat = CATEGORIES[loc.category] || CATEGORIES.custom;
        document.getElementById('detail-dot').style.background = cat.color;
        document.getElementById('detail-name').textContent = loc.name;
        document.getElementById('detail-category').textContent = cat.icon + ' ' + cat.label;
        document.getElementById('detail-address').textContent = loc.address || '';
        document.getElementById('detail-notes').textContent = loc.notes || '';

        var dt = '';
        if (loc.date) {
            dt = formatDate(loc.date);
            if (loc.time) dt += ' at ' + loc.time;
        } else if (loc.time) {
            dt = 'Time: ' + loc.time;
        }
        document.getElementById('detail-datetime').textContent = dt;

        // Store which location is shown
        document.getElementById('detail-sheet').dataset.locationId = id;

        showSheet('detail-sheet');

        // Center map on location
        map.panTo([loc.lat, loc.lng]);
    }

    // =========================================================================
    // Add / Edit Sheet
    // =========================================================================
    function showAddSheet(lat, lng) {
        editingId = null;
        document.getElementById('add-sheet-title').textContent = 'Add Location';
        document.getElementById('location-form').reset();
        document.getElementById('input-lat').value = lat;
        document.getElementById('input-lng').value = lng;
        document.getElementById('input-id').value = '';
        selectCategory('landmark');
        showSheet('add-sheet');
    }

    function showEditSheet(id) {
        var loc = getLocation(id);
        if (!loc) return;

        editingId = id;
        document.getElementById('add-sheet-title').textContent = 'Edit Location';
        document.getElementById('input-name').value = loc.name;
        document.getElementById('input-address').value = loc.address || '';
        document.getElementById('input-date').value = loc.date || '';
        document.getElementById('input-time').value = loc.time || '';
        document.getElementById('input-notes').value = loc.notes || '';
        document.getElementById('input-lat').value = loc.lat;
        document.getElementById('input-lng').value = loc.lng;
        document.getElementById('input-id').value = loc.id;
        selectCategory(loc.category);
        showSheet('add-sheet');
    }

    function handleFormSubmit(e) {
        e.preventDefault();

        var name = document.getElementById('input-name').value.trim();
        if (!name) return;

        var lat = parseFloat(document.getElementById('input-lat').value);
        var lng = parseFloat(document.getElementById('input-lng').value);
        if (isNaN(lat) || isNaN(lng)) {
            showToast('Location not set - tap map first');
            return;
        }

        var data = {
            name: name,
            category: selectedCategory,
            lat: lat,
            lng: lng,
            address: document.getElementById('input-address').value.trim(),
            date: document.getElementById('input-date').value,
            time: document.getElementById('input-time').value,
            notes: document.getElementById('input-notes').value.trim()
        };

        if (editingId) {
            updateLocation(editingId, data);
            showToast('Location updated');
        } else {
            data.id = 'loc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            addLocation(data);
            showToast('Location added!');
        }

        hideAllSheets();
        editingId = null;
    }

    function buildCategorySelector() {
        var container = document.getElementById('category-selector');
        container.innerHTML = '';

        Object.keys(CATEGORIES).forEach(function (key) {
            var cat = CATEGORIES[key];
            var el = document.createElement('div');
            el.className = 'cat-option';
            el.dataset.category = key;
            el.innerHTML =
                '<span class="cat-icon">' + cat.icon + '</span>' +
                '<span class="cat-label">' + cat.label + '</span>';
            el.addEventListener('click', function () { selectCategory(key); });
            container.appendChild(el);
        });

        selectCategory('landmark');
    }

    function selectCategory(key) {
        selectedCategory = key;
        var cat = CATEGORIES[key];
        document.querySelectorAll('.cat-option').forEach(function (el) {
            if (el.dataset.category === key) {
                el.classList.add('selected');
                el.style.borderColor = cat.color;
            } else {
                el.classList.remove('selected');
                el.style.borderColor = '#eee';
            }
        });
    }

    // =========================================================================
    // List Sheet
    // =========================================================================
    function showListSheet() {
        renderList();
        showSheet('list-sheet');
    }

    function renderList() {
        var list = document.getElementById('location-list');
        var filtered = locations.filter(function (l) { return activeFilters[l.category]; });

        // Sort: by date/time if set, then alphabetically
        filtered.sort(function (a, b) {
            if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
            if (a.date && !b.date) return -1;
            if (!a.date && b.date) return 1;
            if (a.date === b.date && a.time && b.time) return a.time < b.time ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        if (filtered.length === 0) {
            list.innerHTML = '<div class="list-empty">No locations match your filters</div>';
            return;
        }

        list.innerHTML = '';
        filtered.forEach(function (loc) {
            var cat = CATEGORIES[loc.category] || CATEGORIES.custom;
            var detail = loc.address || '';
            if (loc.date) detail = formatDate(loc.date) + (loc.time ? ' ' + loc.time : '') + (detail ? ' - ' + detail : '');

            var item = document.createElement('div');
            item.className = 'loc-item';
            item.innerHTML =
                '<span class="loc-dot" style="background:' + cat.color + '"></span>' +
                '<div class="loc-info">' +
                '  <div class="loc-name">' + escapeHtml(loc.name) + '</div>' +
                '  <div class="loc-detail">' + escapeHtml(detail) + '</div>' +
                '</div>' +
                '<span class="loc-arrow">&rsaquo;</span>';

            item.addEventListener('click', function () {
                hideAllSheets();
                map.setView([loc.lat, loc.lng], 16);
                setTimeout(function () { showDetail(loc.id); }, 350);
            });

            list.appendChild(item);
        });
    }

    function buildFilterChips() {
        var container = document.getElementById('filter-chips');
        container.innerHTML = '';

        Object.keys(CATEGORIES).forEach(function (key) {
            var cat = CATEGORIES[key];
            var chip = document.createElement('button');
            chip.className = 'filter-chip active';
            chip.dataset.category = key;
            chip.style.color = cat.color;
            chip.innerHTML = '<span class="chip-dot" style="background:' + cat.color + '"></span>' + cat.label;

            chip.addEventListener('click', function () {
                activeFilters[key] = !activeFilters[key];
                chip.className = 'filter-chip ' + (activeFilters[key] ? 'active' : 'inactive');
                renderAllMarkers();
                renderList();
                if (routeVisible) drawRoute();
            });

            container.appendChild(chip);
        });
    }

    // =========================================================================
    // Add Mode (tap to place pin)
    // =========================================================================
    function enterAddMode() {
        addMode = true;
        document.getElementById('add-mode-banner').classList.remove('hidden');
        document.getElementById('fab-add').classList.add('hidden');
        document.getElementById('fab-ai').classList.add('hidden');
        document.getElementById('map').style.cursor = 'crosshair';
    }

    function exitAddMode() {
        addMode = false;
        document.getElementById('add-mode-banner').classList.add('hidden');
        document.getElementById('fab-add').classList.remove('hidden');
        document.getElementById('fab-ai').classList.remove('hidden');
        document.getElementById('map').style.cursor = '';
        if (tempMarker) {
            map.removeLayer(tempMarker);
            tempMarker = null;
        }
    }

    function onMapClick(e) {
        if (!addMode) return;

        if (tempMarker) map.removeLayer(tempMarker);

        tempMarker = L.marker([e.latlng.lat, e.latlng.lng], {
            icon: createMarkerIcon('custom'),
            opacity: 0.7
        }).addTo(map);

        exitAddMode();
        showAddSheet(e.latlng.lat, e.latlng.lng);
    }

    function useGPS() {
        if (!navigator.geolocation) {
            showToast('GPS not available');
            return;
        }
        showToast('Getting location...');
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                var lat = pos.coords.latitude;
                var lng = pos.coords.longitude;
                map.setView([lat, lng], 16);
                exitAddMode();
                showAddSheet(lat, lng);
            },
            function () {
                showToast('Could not get location');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // =========================================================================
    // Route Drawing
    // =========================================================================
    function toggleRoute() {
        routeVisible = !routeVisible;
        var btn = document.getElementById('btn-route');
        btn.classList.toggle('active', routeVisible);

        if (routeVisible) {
            drawRoute();
            document.getElementById('route-bar').classList.remove('hidden');
        } else {
            clearRoute();
            document.getElementById('route-bar').classList.add('hidden');
        }
    }

    function drawRoute() {
        clearRoute();

        var visible = locations
            .filter(function (l) { return activeFilters[l.category]; })
            .sort(function (a, b) {
                // Sort by date/time, then put undated at end
                if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
                if (a.date && !b.date) return -1;
                if (!a.date && b.date) return 1;
                if (a.time && b.time) return a.time < b.time ? -1 : 1;
                return 0;
            });

        if (visible.length < 2) {
            document.getElementById('route-info').textContent = 'Need 2+ locations for a route';
            return;
        }

        var points = visible.map(function (l) { return [l.lat, l.lng]; });

        routeLayer = L.polyline(points, {
            color: '#1565C0',
            weight: 3,
            opacity: 0.7,
            dashArray: '8, 8'
        }).addTo(map);

        // Calculate total distance
        var totalDist = 0;
        for (var i = 0; i < points.length - 1; i++) {
            var d = haversine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
            totalDist += d;

            // Add distance label at midpoint
            var midLat = (points[i][0] + points[i + 1][0]) / 2;
            var midLng = (points[i][1] + points[i + 1][1]) / 2;
            var label = L.marker([midLat, midLng], {
                icon: L.divIcon({
                    className: 'route-distance-label',
                    html: formatDistance(d),
                    iconSize: [60, 16],
                    iconAnchor: [30, 8]
                }),
                interactive: false
            }).addTo(map);
            routeLabels.push(label);
        }

        var info = visible.length + ' stops - ' + formatDistance(totalDist) + ' total';
        document.getElementById('route-info').textContent = info;
    }

    function clearRoute() {
        if (routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }
        routeLabels.forEach(function (l) { map.removeLayer(l); });
        routeLabels = [];
    }

    function openRouteInGoogleMaps() {
        var visible = locations
            .filter(function (l) { return activeFilters[l.category]; })
            .sort(function (a, b) {
                if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
                if (a.date && !b.date) return -1;
                if (!a.date && b.date) return 1;
                if (a.time && b.time) return a.time < b.time ? -1 : 1;
                return 0;
            });

        if (visible.length < 2) return;

        // Google Maps directions URL: origin, destination, waypoints
        var origin = visible[0].lat + ',' + visible[0].lng;
        var dest = visible[visible.length - 1].lat + ',' + visible[visible.length - 1].lng;
        var waypoints = visible.slice(1, -1)
            .map(function (l) { return l.lat + ',' + l.lng; })
            .join('|');

        var url = 'https://www.google.com/maps/dir/?api=1' +
            '&origin=' + origin +
            '&destination=' + dest +
            '&travelmode=walking';
        if (waypoints) url += '&waypoints=' + waypoints;

        window.open(url, '_blank');
    }

    // =========================================================================
    // Navigate to single location
    // =========================================================================
    function navigateToLocation(id) {
        var loc = getLocation(id);
        if (!loc) return;
        var url = 'https://www.google.com/maps/dir/?api=1' +
            '&destination=' + loc.lat + ',' + loc.lng +
            '&travelmode=walking';
        window.open(url, '_blank');
    }

    // =========================================================================
    // GPS - Show My Location
    // =========================================================================
    function goToMyLocation() {
        // If live tracking is active, just pan to the known position
        if (liveTracking && lastKnownPosition) {
            map.setView([lastKnownPosition.lat, lastKnownPosition.lng], 16);
            return;
        }

        if (!navigator.geolocation) {
            showToast('GPS not available');
            return;
        }
        showToast('Finding you...');
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                var lat = pos.coords.latitude;
                var lng = pos.coords.longitude;

                if (positionMarker) map.removeLayer(positionMarker);
                positionMarker = L.circleMarker([lat, lng], {
                    radius: 8,
                    fillColor: '#4285F4',
                    fillOpacity: 1,
                    color: '#fff',
                    weight: 3
                }).addTo(map);

                map.setView([lat, lng], 16);
            },
            function () {
                showToast('Could not get location');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // =========================================================================
    // Live Tracking
    // =========================================================================
    function toggleTracking() {
        if (liveTracking) {
            stopTracking();
            return;
        }

        if (!navigator.geolocation) {
            showToast('GPS not available on this device');
            return;
        }

        // Check permission state if API available
        if (navigator.permissions) {
            navigator.permissions.query({ name: 'geolocation' }).then(function (result) {
                if (result.state === 'denied') {
                    showToast('Location access denied. Enable in browser settings.');
                    return;
                }
                startTracking();

                // Watch for permission revocation
                result.addEventListener('change', function () {
                    if (result.state === 'denied' && liveTracking) {
                        stopTracking();
                        showToast('Location permission revoked');
                    }
                });
            }).catch(function () {
                startTracking();
            });
        } else {
            startTracking();
        }
    }

    function startTracking() {
        if (watchId !== null) return;

        liveTracking = true;
        consecutiveErrors = 0;
        stationaryCount = 0;
        currentHighAccuracy = true;
        lastKnownPosition = null;
        lastRenderedPosition = null;

        // Remove one-shot position marker if present
        if (positionMarker) {
            map.removeLayer(positionMarker);
            positionMarker = null;
        }

        updateTrackingUI(true);
        showToast('Live tracking enabled');
        announceTrackingStatus('Live tracking enabled');

        watchId = navigator.geolocation.watchPosition(
            onTrackingPosition,
            onTrackingError,
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 5000
            }
        );

        // Listen for page visibility changes
        document.addEventListener('visibilitychange', onVisibilityChange);
    }

    function stopTracking() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }

        liveTracking = false;
        pendingPosition = null;

        if (renderTimeoutId) {
            clearTimeout(renderTimeoutId);
            renderTimeoutId = null;
        }
        if (autoStopTimer) {
            clearTimeout(autoStopTimer);
            autoStopTimer = null;
        }

        // Remove tracking layers
        if (trackingLayer) {
            map.removeLayer(trackingLayer);
            trackingLayer = null;
            trackingDot = null;
            trackingAccuracyCircle = null;
        }

        document.removeEventListener('visibilitychange', onVisibilityChange);

        updateTrackingUI(false);
        showToast('Live tracking disabled');
        announceTrackingStatus('Live tracking disabled');
    }

    function onTrackingPosition(pos) {
        consecutiveErrors = 0;

        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        var accuracy = pos.coords.accuracy;
        var heading = pos.coords.heading;

        lastKnownPosition = { lat: lat, lng: lng, accuracy: accuracy };

        // Adaptive accuracy: reduce GPS usage when stationary
        if (lastRenderedPosition) {
            var dist = haversine(lastRenderedPosition.lat, lastRenderedPosition.lng, lat, lng);
            if (dist < 5) {
                stationaryCount++;
            } else {
                stationaryCount = 0;
            }

            // After ~30s stationary, switch to low accuracy
            if (stationaryCount > 6 && currentHighAccuracy) {
                restartWatchWithAccuracy(false);
            } else if (stationaryCount === 0 && !currentHighAccuracy) {
                restartWatchWithAccuracy(true);
            }
        }

        // Throttle rendering to max once per second
        var now = Date.now();
        pendingPosition = { lat: lat, lng: lng, accuracy: accuracy, heading: heading };

        if (now - lastRenderTimestamp >= MIN_RENDER_INTERVAL) {
            renderTrackingPosition();
        } else if (!renderTimeoutId) {
            renderTimeoutId = setTimeout(function () {
                renderTrackingPosition();
            }, MIN_RENDER_INTERVAL - (now - lastRenderTimestamp));
        }
    }

    function renderTrackingPosition() {
        renderTimeoutId = null;
        if (!pendingPosition) return;

        var pos = pendingPosition;
        pendingPosition = null;
        lastRenderTimestamp = Date.now();
        lastRenderedPosition = { lat: pos.lat, lng: pos.lng };

        updatePositionOnMap(pos.lat, pos.lng, pos.accuracy);
    }

    function updatePositionOnMap(lat, lng, accuracy) {
        var latlng = L.latLng(lat, lng);

        if (!trackingLayer) {
            // First time: create all layers
            trackingLayer = L.layerGroup().addTo(map);

            trackingAccuracyCircle = L.circle(latlng, {
                radius: accuracy,
                fillColor: '#4285F4',
                fillOpacity: 0.08,
                color: '#4285F4',
                weight: 1,
                opacity: 0.3
            }).addTo(trackingLayer);

            trackingDot = L.circleMarker(latlng, {
                radius: 8,
                fillColor: '#4285F4',
                fillOpacity: 1,
                color: '#fff',
                weight: 3
            }).addTo(trackingLayer);

            // Center on first position
            map.setView(latlng, Math.max(map.getZoom(), 15));
        } else {
            // Update in place (no DOM recreation)
            trackingDot.setLatLng(latlng);
            trackingAccuracyCircle.setLatLng(latlng);
            trackingAccuracyCircle.setRadius(accuracy);
        }
    }

    function onTrackingError(err) {
        consecutiveErrors++;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            stopTracking();
            showToast('Tracking stopped - GPS unavailable');
            return;
        }

        switch (err.code) {
            case err.PERMISSION_DENIED:
                stopTracking();
                showToast('Location permission denied');
                break;
            case err.POSITION_UNAVAILABLE:
                showToast('GPS signal lost - retrying...');
                break;
            case err.TIMEOUT:
                showToast('Location taking longer than expected...');
                break;
        }
    }

    function restartWatchWithAccuracy(highAccuracy) {
        currentHighAccuracy = highAccuracy;
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
        }
        watchId = navigator.geolocation.watchPosition(
            onTrackingPosition,
            onTrackingError,
            {
                enableHighAccuracy: highAccuracy,
                timeout: highAccuracy ? 15000 : 30000,
                maximumAge: highAccuracy ? 5000 : 15000
            }
        );
    }

    function updateTrackingUI(active) {
        var btn = document.getElementById('btn-live-track');
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    function announceTrackingStatus(message) {
        var el = document.getElementById('tracking-status');
        if (el) el.textContent = message;
    }

    // Page Visibility API - pause/resume tracking for battery savings
    function onVisibilityChange() {
        if (!liveTracking) return;

        if (document.hidden) {
            hiddenTimestamp = Date.now();
            autoStopTimer = setTimeout(function () {
                if (liveTracking && document.hidden) {
                    stopTracking();
                }
            }, MAX_HIDDEN_DURATION);
        } else {
            if (autoStopTimer) {
                clearTimeout(autoStopTimer);
                autoStopTimer = null;
            }

            // If hidden for too long, tracking was already stopped
            if (!liveTracking) return;

            // Restart the watcher in case it was paused by the browser
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
            }
            watchId = navigator.geolocation.watchPosition(
                onTrackingPosition,
                onTrackingError,
                {
                    enableHighAccuracy: currentHighAccuracy,
                    timeout: 15000,
                    maximumAge: 5000
                }
            );
        }
    }

    // =========================================================================
    // Offline Tile Download
    // =========================================================================
    function startTileDownload() {
        if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
            showToast('Service worker not ready - reload and try again');
            return;
        }

        document.getElementById('download-modal').classList.remove('hidden');
        document.getElementById('download-status').textContent = 'Downloading Rome area tiles...';
        document.getElementById('download-percent').textContent = '0%';
        document.getElementById('progress-fill').style.width = '0%';

        // Rome bounding box with some margin
        navigator.serviceWorker.controller.postMessage({
            type: 'DOWNLOAD_TILES',
            bounds: { north: 41.94, south: 41.87, west: 12.43, east: 12.54 },
            minZoom: 13,
            maxZoom: 16
        });
    }

    function onDownloadProgress(downloaded, total) {
        var pct = Math.round((downloaded / total) * 100);
        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('download-percent').textContent = pct + '% (' + downloaded + '/' + total + ' tiles)';
    }

    function onDownloadComplete(total) {
        document.getElementById('download-modal').classList.add('hidden');
        showToast('Offline map ready! (' + total + ' tiles cached)');
    }

    function registerSW() {
        if (!('serviceWorker' in navigator)) return;

        navigator.serviceWorker.register('sw.js').then(function () {
            // Listen for download progress messages
            navigator.serviceWorker.addEventListener('message', function (e) {
                if (e.data.type === 'DOWNLOAD_PROGRESS') {
                    onDownloadProgress(e.data.downloaded, e.data.total);
                } else if (e.data.type === 'DOWNLOAD_COMPLETE') {
                    onDownloadComplete(e.data.total);
                }
            });
        }).catch(function (err) {
            console.warn('SW registration failed:', err);
        });
    }

    // =========================================================================
    // UI Sheets
    // =========================================================================
    function showSheet(id) {
        hideAllSheets();
        document.getElementById('overlay').classList.remove('hidden');
        var sheet = document.getElementById(id);
        sheet.classList.remove('hidden');
        // Force reflow then add visible class for animation
        sheet.offsetHeight;
        sheet.classList.add('visible');
    }

    function hideAllSheets() {
        document.getElementById('overlay').classList.add('hidden');
        document.querySelectorAll('.bottom-sheet').forEach(function (sheet) {
            sheet.classList.remove('visible');
            // Wait for animation before hiding
            setTimeout(function () {
                if (!sheet.classList.contains('visible')) {
                    sheet.classList.add('hidden');
                }
            }, 300);
        });

        if (tempMarker) {
            map.removeLayer(tempMarker);
            tempMarker = null;
        }
        editingId = null;
    }

    // =========================================================================
    // Toast
    // =========================================================================
    function showToast(msg) {
        var toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.remove('hidden');
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () { toast.classList.add('hidden'); }, 300);
        }, 2500);
    }

    // =========================================================================
    // Helpers
    // =========================================================================
    function haversine(lat1, lng1, lat2, lng2) {
        var R = 6371000;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function formatDistance(meters) {
        if (meters < 1000) return Math.round(meters) + 'm';
        return (meters / 1000).toFixed(1) + 'km';
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        var parts = dateStr.split('-');
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return parseInt(parts[2], 10) + ' ' + months[parseInt(parts[1], 10) - 1];
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // =========================================================================
    // AI Pin Creator
    // =========================================================================
    var AI_SYSTEM_PROMPT = 'You extract location information from text or images about places to visit. ' +
        'Return ONLY a valid JSON array (no markdown fences, no explanation). ' +
        'Each object must have: ' +
        '"name" (string), ' +
        '"category" (one of: "accommodation", "landmark", "food", "entertainment", "shopping", "custom"), ' +
        '"address" (string - full street address if available, otherwise ""), ' +
        '"lat" (number - accurate GPS latitude), ' +
        '"lng" (number - accurate GPS longitude), ' +
        '"notes" (string - include ALL useful details: opening hours, admission fees, tips, website URLs, phone numbers, recommended duration. Separate with newlines), ' +
        '"date" (string - ISO YYYY-MM-DD if a specific date is mentioned, otherwise ""), ' +
        '"time" (string - HH:MM if a specific time is mentioned, otherwise ""). ' +
        'Assume locations are in Rome, Italy unless clearly stated otherwise. ' +
        'Use accurate GPS coordinates for well-known landmarks and attractions.';

    function getAIProvider() {
        return localStorage.getItem(AI_PROVIDER_STORAGE) || 'google';
    }

    function showAISheet() {
        var apiKey = localStorage.getItem(AI_KEY_STORAGE);
        if (!apiKey) {
            showAIKeyModal();
            return;
        }

        // Reset state
        document.getElementById('ai-text-input').value = '';
        aiImageData = null;
        aiExtractedLocations = [];
        document.getElementById('ai-image-preview').classList.add('hidden');
        document.getElementById('ai-input-section').classList.remove('hidden');
        document.getElementById('ai-results-section').classList.add('hidden');
        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('ai-sheet-title').textContent = 'AI Pin Creator';

        showSheet('ai-sheet');
    }

    function showAIKeyModal() {
        var provider = getAIProvider();
        var keyInput = document.getElementById('ai-key-input');
        keyInput.value = localStorage.getItem(AI_KEY_STORAGE) || '';

        // Update tab selection
        document.querySelectorAll('.ai-provider-tab').forEach(function (tab) {
            tab.classList.toggle('active', tab.dataset.provider === provider);
        });
        updateKeyPlaceholder(provider);

        document.getElementById('ai-key-modal').classList.remove('hidden');
    }

    function updateKeyPlaceholder(provider) {
        var input = document.getElementById('ai-key-input');
        var help = document.getElementById('ai-key-help');
        if (provider === 'anthropic') {
            input.placeholder = 'sk-ant-...';
            help.innerHTML = 'Get your key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>';
        } else {
            input.placeholder = 'AIza...';
            help.innerHTML = 'Get your key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>';
        }
    }

    function hideAIKeyModal() {
        document.getElementById('ai-key-modal').classList.add('hidden');
    }

    function saveAIKey() {
        var key = document.getElementById('ai-key-input').value.trim();
        if (!key) {
            showToast('Please enter an API key');
            return;
        }

        // Get selected provider from active tab
        var activeTab = document.querySelector('.ai-provider-tab.active');
        var provider = activeTab ? activeTab.dataset.provider : 'google';

        localStorage.setItem(AI_KEY_STORAGE, key);
        localStorage.setItem(AI_PROVIDER_STORAGE, provider);
        hideAIKeyModal();
        showToast('Settings saved (' + (provider === 'google' ? 'Gemini' : 'Claude') + ')');

        // If AI sheet isn't open yet, open it now
        var aiSheet = document.getElementById('ai-sheet');
        if (aiSheet.classList.contains('hidden')) {
            showAISheet();
        }
    }

    function handleAIPaste(e) {
        var aiSheet = document.getElementById('ai-sheet');
        if (aiSheet.classList.contains('hidden')) return;

        var items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                var blob = items[i].getAsFile();
                compressImage(blob, function (dataUrl) {
                    aiImageData = dataUrl;
                    showAIImagePreview(dataUrl);
                });
                e.preventDefault();
                return;
            }
        }
    }

    function handleAIFileInput(e) {
        var file = e.target.files[0];
        if (!file || file.type.indexOf('image') === -1) return;

        compressImage(file, function (dataUrl) {
            aiImageData = dataUrl;
            showAIImagePreview(dataUrl);
        });
    }

    function compressImage(blob, callback) {
        var img = new Image();
        img.onload = function () {
            var MAX_DIM = 1024;
            var w = img.width;
            var h = img.height;

            // Only resize if larger than MAX_DIM
            if (w > MAX_DIM || h > MAX_DIM) {
                if (w > h) {
                    h = Math.round(h * MAX_DIM / w);
                    w = MAX_DIM;
                } else {
                    w = Math.round(w * MAX_DIM / h);
                    h = MAX_DIM;
                }
            }

            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            callback(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = URL.createObjectURL(blob);
    }

    function showAIImagePreview(dataUrl) {
        var preview = document.getElementById('ai-image-preview');
        document.getElementById('ai-preview-img').src = dataUrl;
        preview.classList.remove('hidden');
    }

    function removeAIImage() {
        aiImageData = null;
        document.getElementById('ai-image-preview').classList.add('hidden');
        document.getElementById('ai-preview-img').src = '';
        document.getElementById('ai-file-input').value = '';
    }

    function processAIContent() {
        var text = document.getElementById('ai-text-input').value.trim();
        if (!text && !aiImageData) {
            showToast('Paste some text or an image first');
            return;
        }

        var apiKey = localStorage.getItem(AI_KEY_STORAGE);
        if (!apiKey) {
            showAIKeyModal();
            return;
        }

        // Show loading
        document.getElementById('ai-input-section').classList.add('hidden');
        document.getElementById('ai-loading').classList.remove('hidden');

        var provider = getAIProvider();
        var request;

        if (provider === 'anthropic') {
            request = callAnthropic(apiKey, text, aiImageData);
        } else {
            request = callGemini(apiKey, text, aiImageData);
        }

        request
        .then(function (parsed) {
            if (!Array.isArray(parsed)) parsed = [parsed];
            aiExtractedLocations = parsed;
            showAIResults(parsed);
        })
        .catch(function (err) {
            document.getElementById('ai-loading').classList.add('hidden');
            document.getElementById('ai-input-section').classList.remove('hidden');
            var msg = err.message || 'Unknown error';

            // Provide actionable error messages
            if (msg === 'Failed to fetch') {
                var prov = getAIProvider();
                if (prov === 'anthropic') {
                    msg = 'Cannot reach Anthropic API from browser. Try Google Gemini instead.';
                } else {
                    msg = 'Network error. Check your connection.';
                }
            } else if (msg.indexOf('API key') !== -1 || msg.indexOf('API_KEY') !== -1) {
                msg = 'Invalid API key. Tap the gear icon to update it.';
            } else if (msg.length > 70) {
                msg = msg.substring(0, 70) + '...';
            }

            showToast(msg);
        });
    }

    // --- Google Gemini API ---
    function callGemini(apiKey, text, imageData) {
        var parts = [];
        var userText = 'Extract location info from this';
        if (imageData && !text) userText += ' image';
        userText += ':\n\n';
        if (text) userText += text;

        parts.push({ text: AI_SYSTEM_PROMPT + '\n\n' + userText });

        if (imageData) {
            // imageData is a data URL like "data:image/png;base64,iVBOR..."
            var commaIdx = imageData.indexOf(',');
            var meta = imageData.substring(0, commaIdx); // "data:image/png;base64"
            var mimeType = meta.replace('data:', '').replace(';base64', '');
            var base64 = imageData.substring(commaIdx + 1);

            parts.push({
                inline_data: {
                    mime_type: mimeType,
                    data: base64
                }
            });
        }

        var body = {
            contents: [{ parts: parts }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 4000
            }
        };

        var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;

        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function (response) {
            if (!response.ok) {
                return response.json().then(function (err) {
                    var msg = (err.error && err.error.message) ? err.error.message : 'Gemini API error (' + response.status + ')';
                    throw new Error(msg);
                });
            }
            return response.json();
        })
        .then(function (data) {
            var content = data.candidates[0].content.parts[0].text;
            content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            return JSON.parse(content);
        });
    }

    // --- Anthropic Claude API ---
    function callAnthropic(apiKey, text, imageData) {
        var userContent = [];
        var userText = 'Extract location info from this';
        if (imageData && !text) userText += ' image';
        userText += ':\n\n';
        if (text) userText += text;

        userContent.push({ type: 'text', text: userText });

        if (imageData) {
            var commaIdx = imageData.indexOf(',');
            var meta = imageData.substring(0, commaIdx);
            var mediaType = meta.replace('data:', '').replace(';base64', '');
            var base64 = imageData.substring(commaIdx + 1);

            userContent.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64
                }
            });
        }

        var body = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4000,
            system: AI_SYSTEM_PROMPT,
            messages: [{
                role: 'user',
                content: userContent
            }]
        };

        return fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(body)
        })
        .then(function (response) {
            if (!response.ok) {
                return response.json().then(function (err) {
                    var msg = (err.error && err.error.message) ? err.error.message : 'Claude API error (' + response.status + ')';
                    throw new Error(msg);
                });
            }
            return response.json();
        })
        .then(function (data) {
            var content = data.content[0].text;
            content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            return JSON.parse(content);
        });
    }

    function showAIResults(locs) {
        document.getElementById('ai-loading').classList.add('hidden');

        if (!locs || locs.length === 0) {
            document.getElementById('ai-input-section').classList.remove('hidden');
            showToast('No locations found in content');
            return;
        }

        document.getElementById('ai-sheet-title').textContent = 'Found ' + locs.length + ' Location' + (locs.length > 1 ? 's' : '');
        document.getElementById('ai-results-summary').textContent = 'Review the extracted locations below, then add them to your map.';

        var list = document.getElementById('ai-results-list');
        list.innerHTML = '';

        locs.forEach(function (loc, idx) {
            var cat = CATEGORIES[loc.category] || CATEGORIES.custom;
            var notesPreview = (loc.notes || '').split('\n')[0];
            if (notesPreview.length > 80) notesPreview = notesPreview.substr(0, 80) + '...';

            var card = document.createElement('div');
            card.className = 'ai-result-card';
            card.dataset.index = idx;
            card.innerHTML =
                '<div class="ai-result-header">' +
                '  <span class="ai-result-icon" style="background:' + cat.color + '">' + cat.icon + '</span>' +
                '  <div class="ai-result-info">' +
                '    <div class="ai-result-name">' + escapeHtml(loc.name) + '</div>' +
                '    <div class="ai-result-category">' + cat.label + (loc.address ? ' &middot; ' + escapeHtml(loc.address) : '') + '</div>' +
                '  </div>' +
                '</div>' +
                (notesPreview ? '<div class="ai-result-notes">' + escapeHtml(notesPreview) + '</div>' : '') +
                '<div class="ai-result-actions">' +
                '  <button type="button" class="action-btn ai-btn-add-one" data-index="' + idx + '">Add</button>' +
                '</div>';

            list.appendChild(card);
        });

        // Bind individual add buttons
        list.querySelectorAll('.ai-btn-add-one').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var i = parseInt(btn.dataset.index, 10);
                addSingleAILocation(i, btn);
            });
        });

        document.getElementById('ai-results-section').classList.remove('hidden');
    }

    function addSingleAILocation(index, btnEl) {
        var loc = aiExtractedLocations[index];
        if (!loc || !loc.name) return;

        var data = {
            id: 'loc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: loc.name,
            category: CATEGORIES[loc.category] ? loc.category : 'custom',
            lat: parseFloat(loc.lat) || ROME_CENTER[0],
            lng: parseFloat(loc.lng) || ROME_CENTER[1],
            address: loc.address || '',
            date: loc.date || '',
            time: loc.time || '',
            notes: loc.notes || ''
        };

        addLocation(data);

        // Update button
        if (btnEl) {
            btnEl.textContent = 'Added';
            btnEl.disabled = true;
            btnEl.classList.add('added');
        }

        showToast(loc.name + ' added!');
    }

    function addAllAILocations() {
        var count = 0;
        var btns = document.querySelectorAll('.ai-btn-add-one');

        aiExtractedLocations.forEach(function (loc, idx) {
            if (!loc || !loc.name) return;

            // Skip already-added
            var btn = btns[idx];
            if (btn && btn.disabled) return;

            var data = {
                id: 'loc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5) + idx,
                name: loc.name,
                category: CATEGORIES[loc.category] ? loc.category : 'custom',
                lat: parseFloat(loc.lat) || ROME_CENTER[0],
                lng: parseFloat(loc.lng) || ROME_CENTER[1],
                address: loc.address || '',
                date: loc.date || '',
                time: loc.time || '',
                notes: loc.notes || ''
            };

            addLocation(data);
            count++;

            if (btn) {
                btn.textContent = 'Added';
                btn.disabled = true;
                btn.classList.add('added');
            }
        });

        if (count > 0) {
            showToast(count + ' location' + (count > 1 ? 's' : '') + ' added!');
            hideAllSheets();
            fitAllMarkers();
        }
    }

    function aiGoBack() {
        document.getElementById('ai-results-section').classList.add('hidden');
        document.getElementById('ai-input-section').classList.remove('hidden');
        document.getElementById('ai-sheet-title').textContent = 'AI Pin Creator';
    }

    // =========================================================================
    // Event Listeners
    // =========================================================================
    function setupEvents() {
        // FAB - enter add mode
        document.getElementById('fab-add').addEventListener('click', function () {
            enterAddMode();
        });

        // Add mode - cancel
        document.getElementById('btn-cancel-add').addEventListener('click', function () {
            exitAddMode();
        });

        // Add mode - use GPS
        document.getElementById('btn-use-gps').addEventListener('click', function () {
            useGPS();
        });

        // Header buttons
        document.getElementById('btn-live-track').addEventListener('click', toggleTracking);
        document.getElementById('btn-my-location').addEventListener('click', goToMyLocation);
        document.getElementById('btn-fit-all').addEventListener('click', fitAllMarkers);
        document.getElementById('btn-route').addEventListener('click', toggleRoute);
        document.getElementById('btn-download').addEventListener('click', startTileDownload);
        document.getElementById('btn-list').addEventListener('click', showListSheet);

        // Overlay click - close sheets
        document.getElementById('overlay').addEventListener('click', hideAllSheets);

        // Detail sheet actions
        document.getElementById('btn-navigate').addEventListener('click', function () {
            var id = document.getElementById('detail-sheet').dataset.locationId;
            navigateToLocation(id);
        });

        document.getElementById('btn-edit').addEventListener('click', function () {
            var id = document.getElementById('detail-sheet').dataset.locationId;
            hideAllSheets();
            setTimeout(function () { showEditSheet(id); }, 350);
        });

        document.getElementById('btn-delete').addEventListener('click', function () {
            var id = document.getElementById('detail-sheet').dataset.locationId;
            if (confirm('Delete this location?')) {
                deleteLocation(id);
                hideAllSheets();
                showToast('Location deleted');
            }
        });

        // Add/Edit form
        document.getElementById('location-form').addEventListener('submit', handleFormSubmit);

        document.getElementById('btn-cancel-form').addEventListener('click', function () {
            hideAllSheets();
        });

        // Route bar
        document.getElementById('btn-route-gmaps').addEventListener('click', openRouteInGoogleMaps);
        document.getElementById('btn-route-close').addEventListener('click', toggleRoute);

        // Download modal cancel
        document.getElementById('btn-cancel-download').addEventListener('click', function () {
            document.getElementById('download-modal').classList.add('hidden');
        });

        // AI Pin Creator
        document.getElementById('fab-ai').addEventListener('click', showAISheet);
        document.getElementById('btn-ai-cancel').addEventListener('click', hideAllSheets);
        document.getElementById('btn-ai-extract').addEventListener('click', processAIContent);
        document.getElementById('btn-ai-back').addEventListener('click', aiGoBack);
        document.getElementById('btn-ai-add-all').addEventListener('click', addAllAILocations);
        document.getElementById('btn-ai-settings').addEventListener('click', showAIKeyModal);
        document.getElementById('btn-key-save').addEventListener('click', saveAIKey);
        document.getElementById('btn-key-cancel').addEventListener('click', hideAIKeyModal);
        document.getElementById('btn-remove-image').addEventListener('click', removeAIImage);
        document.getElementById('ai-file-input').addEventListener('change', handleAIFileInput);

        // Listen for paste events (image paste into AI sheet)
        document.addEventListener('paste', handleAIPaste);

        // Provider tab switching in settings modal
        document.querySelectorAll('.ai-provider-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.ai-provider-tab').forEach(function (t) {
                    t.classList.remove('active');
                });
                tab.classList.add('active');
                updateKeyPlaceholder(tab.dataset.provider);
                // Clear key input when switching providers so user enters the right key
                document.getElementById('ai-key-input').value = '';
            });
        });

        // Handle sheet drag to dismiss (simple swipe-down)
        document.querySelectorAll('.sheet-handle').forEach(function (handle) {
            var startY = 0;
            handle.addEventListener('touchstart', function (e) {
                startY = e.touches[0].clientY;
            }, { passive: true });
            handle.addEventListener('touchend', function (e) {
                var endY = e.changedTouches[0].clientY;
                if (endY - startY > 50) {
                    hideAllSheets();
                }
            }, { passive: true });
        });
    }

    // =========================================================================
    // Start
    // =========================================================================
    document.addEventListener('DOMContentLoaded', init);
})();
