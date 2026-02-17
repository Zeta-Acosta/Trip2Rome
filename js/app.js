(function () {
    'use strict';

    // =========================================================================
    // Configuration
    // =========================================================================
    var ROME_CENTER = [41.9028, 12.4964];
    var DEFAULT_ZOOM = 13;
    var STORAGE_KEY = 'trip2rome_locations';

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
        document.getElementById('map').style.cursor = 'crosshair';
    }

    function exitAddMode() {
        addMode = false;
        document.getElementById('add-mode-banner').classList.add('hidden');
        document.getElementById('fab-add').classList.remove('hidden');
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
