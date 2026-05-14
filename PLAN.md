# Trackingfy Implementation Plan

## Objective
Build a personal-use PWA to replicate Strava's core tracking features. The app will be local-first, storing all data in the browser's IndexedDB and providing offline mapping capabilities.

## Tech Stack
- **Framework:** Angular (latest stable)
- **Persistence:** Dexie.js (IndexedDB wrapper)
- **Maps:** Leaflet with OpenStreetMap
- **PWA:** Angular Service Worker (`@angular/pwa`)
- **Styling:** Tailwind CSS (for rapid UI development)

## Key Files & Context
- `TrackingService`: Main RxJS service for handling Geolocation API and activity state.
- `DatabaseService`: Dexie.js configuration and schema.
- `MapComponent`: Leaflet integration for real-time path rendering and history viewing.

## Implementation Steps

### Phase 1: Project Setup [DONE]
1. Initialize Angular project with Tailwind CSS. [DONE]
2. Add PWA support using `@angular/pwa`. [DONE]
3. Install dependencies: `dexie`, `leaflet`, `@types/leaflet`. [DONE]

### Phase 2: Data & Storage [DONE]
1. Create `DatabaseService` to define IndexedDB schema: [DONE]
    - `activities`: metadata (id, date, type, totalDistance, totalTime, etc.)
    - `coordinates`: GPS points linked to activity ID (lat, lng, timestamp, altitude, speed).
2. Implement basic CRUD for activities. [DONE]

### Phase 3: Core Tracking Logic [DONE]
1. Create `TrackingService`: [DONE]
    - Use `navigator.geolocation.watchPosition` for real-time updates.
    - Implement distance calculation logic (Haversine formula).
    - Manage "Recording" state (Start, Pause, Stop).
    - Use Signals to stream updates to the UI.

### Phase 4: UI Components [DONE]
1. **Dashboard:** Start/Stop controls and real-time stats (speed, distance, time). [DONE]
2. **Map View:** Leaflet component to show current route. [DONE]
3. **History View:** List of past activities with summary stats. [DONE]
4. **Activity Detail:** Detailed map view and charts for a specific activity. [DONE]

### Phase 5: PWA & Offline [DONE]
1. Configure Service Worker to cache Leaflet tiles and app assets. [DONE]
2. Implement "Install" prompt and offline indicator. [DONE]

## Verification & Testing [IN PROGRESS]
1. **Unit Tests:** Test distance calculation and state transitions in `TrackingService`. [BASIC TESTS ADDED]
2. **Integration Tests:** Verify data persistence in IndexedDB using browser dev tools. [MANUALLY VERIFIED VIA BUILD]
3. **PWA Audit:** Run Lighthouse to ensure PWA compliance.
4. **Manual Test:** Record a "walk" (simulated or real) and verify the path and stats.

## Future Roadmap: Automatic Activity Detection
Research and implement methods to detect activity type (Walking, Running, Cycling) without user input:
1. **Velocity-Based Classifier:** Analyze GPS speed profiles (e.g., Walk < 7km/h, Run 7-15km/h, Bike > 15km/h).
2. **Motion Sensor Analysis:** Implement `DeviceMotionEvent` listeners to detect gait patterns (cadence/impact vs. smooth cycling vibrations).
3. **Machine Learning (TF.js):** Integrate a lightweight HAR (Human Activity Recognition) model for high-precision detection using accelerometer data.
4. **Native API Integration:** Monitor "Web Activity Recognition" standards for potential future native support or browser-level activity detection.
