# Trip2Rome

Interactive travel map for our Rome trip. Pin locations, plan routes, and navigate offline.

## How to Use

### Install as a PWA (Recommended)
1. Host on GitHub Pages: **Settings > Pages > Source: main branch**
2. Open the site URL in Chrome on your phone
3. Tap the browser menu > **"Add to Home Screen"**
4. The app now launches fullscreen like a native app

### Features
- **Interactive map** of Rome with OpenStreetMap
- **Color-coded pins** by category (Stay, Sights, Food, Fun, Shopping, Other)
- **Tap any pin** to see details, navigate, edit, or delete
- **Add locations on the fly** - tap +, then tap the map (or use GPS)
- **Date & time scheduling** for each location
- **Walking route** with distances between your stops
- **Open in Google Maps** for turn-by-turn walking directions
- **Offline map** - download Rome tiles for use without internet
- **Filter by category** in the list view
- **All data saved locally** in your browser (localStorage)

### Buttons Guide
- **+** (orange circle) - Add a new location
- **Crosshair** - Show your current GPS location
- **Four corners** - Zoom to fit all pins
- **Diamond arrow** - Show/hide walking route between locations
- **Down arrow** - Download offline map tiles for Rome
- **List icon** - View all locations as a list with filters

### Offline Support
Tap the download button to pre-cache Rome map tiles (zoom 13-16). This downloads ~200 tiles (~5MB) so the map works without internet. Tiles you browse are also automatically cached.

### Adding Locations While Exploring
1. Tap the **+** button
2. Tap the map where you are (or tap **"Use GPS"** for your exact location)
3. Fill in name, pick a category, add notes and time
4. Tap **Save** - done!

## Tech Stack
- **Leaflet.js** + **OpenStreetMap** (free, no API key needed)
- **PWA** with Service Worker for offline support
- **localStorage** for data persistence
- Zero build tools, zero dependencies to install
