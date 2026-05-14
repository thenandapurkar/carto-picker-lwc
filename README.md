# Carto Picker LWC

A pan-to-pick map component for Salesforce Flows. Users drag the map to center a crosshair on a location, confirm their selection, and the component outputs the latitude, longitude, and full street address — all without typing an address.

<img width="524" height="525" alt="Screenshot 2026-05-14 at 12 08 36 PM" src="https://github.com/user-attachments/assets/0c9e7ec8-0113-4e8b-ac10-5195ce24a32d" /> 


Built with [Leaflet.js](https://leafletjs.com/) and [CARTO](https://carto.com/) raster basemaps. **No API keys required.** Reverse geocoding is handled by [Nominatim (OpenStreetMap)](https://nominatim.openstreetmap.org/) — also free, no keys.

## Install

Click the button below to deploy directly into your Salesforce org:

<a href="https://githubsfdeploy.herokuapp.com?owner=thenandapurkar&repo=carto-picker-lwc&ref=main">
  <img alt="Deploy to Salesforce" src="https://raw.githubusercontent.com/afawcett/githubsfdeploy/master/deploy.png">
</a>

### Manual Install

1. Clone this repo
2. Deploy with Salesforce CLI:
   ```bash
   sf project deploy start --source-dir force-app
   ```

### Post-Install

Add `https://nominatim.openstreetmap.org` and `https://*.basemaps.cartocdn.com` to your org's **CSP Trusted Sites** (Setup → CSP Trusted Sites → New) so the map tiles and reverse geocoding work.

---

## How It Works

1. The map loads centered on the coordinates you provide (defaults to Denver, CO)
2. A **crosshair** sits fixed at the center of the map — the user pans/zooms to move it over the desired location
3. As the map moves, the component **reverse geocodes** the center point and displays the street address in a bar at the bottom
4. The user taps **Confirm** to lock the location — a pin drops, the map locks, and all output variables are set
5. The user can tap **Change** to unlock the map and pick a different spot

This pattern works better than a typed address for many government use cases — residents often know *where* something is but not the exact address (a pothole on a specific block, a park, an intersection).

---

## Use in a Flow

Drag the **Map Picker (Leaflet + CartoDB)** component onto any Flow Screen.

### Input Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `inputLatitude` | String | `"39.7520"` | Starting center latitude |
| `inputLongitude` | String | `"-104.9915"` | Starting center longitude |
| `mapZoomLevel` | Integer | `16` | Initial zoom level (1–20) |
| `mapHeight` | Integer | `500` | Map height in pixels |
| `mapStyle` | String | `"voyager"` | CartoDB basemap style (see styles below) |

### Output Properties

These are automatically set when the user confirms a location:

| Property | Type | Description |
|----------|------|-------------|
| `selectedLatitude` | String | Latitude of the confirmed point |
| `selectedLongitude` | String | Longitude of the confirmed point |
| `street` | String | Street address (e.g. `"1420 NE 5th St"`) |
| `city` | String | City name |
| `state` | String | State name |
| `postal` | String | ZIP / postal code |
| `fullStreetAddress` | String | Full formatted address from the geocoder |

Wire the outputs to your Flow variables and use them to populate Case, Work Order, or any record.

### Map Styles

| Style | Description |
|-------|-------------|
| `voyager` | Default — clean, colorful, general-purpose (recommended) |
| `voyager_nolabels` | Voyager without text labels |
| `voyager_labels_under` | Voyager with labels rendered under data layers |
| `positron` | Light/minimal grayscale |
| `positron_nolabels` | Positron without text labels |
| `dark_matter` | Dark theme |
| `dark_matter_nolabels` | Dark theme without text labels |

---

## Use Cases

### 311 / Constituent Services

The original use case. A resident submits a service request (pothole, graffiti, streetlight out, illegal dumping) through an Experience Cloud portal or a Flow. Instead of typing an address, they pan the map to the exact spot. The confirmed coordinates and address are written to the Case record, enabling:
- Automatic routing to the correct department based on location
- Proximity-based deduplication (multiple reports for the same pothole)
- Map-based dashboards for operations teams

### License, Permit & Inspection (LPI)

An applicant filing a building permit, special event permit, or business license pins the location of the property or venue on the map. The component returns the address and coordinates, which can be used to:
- Auto-populate the property address on the permit record
- Look up parcel data or zoning information based on coordinates
- Assign the inspection to the nearest available inspector

### Field Service / Work Orders

A dispatcher or field technician uses the map to mark the exact location of a work order — utility repair, tree removal, road maintenance. The coordinates feed into:
- Salesforce Field Service for route optimization
- Geofencing to auto-complete work orders when a technician arrives on site

### Code Enforcement

A resident or officer reports a code violation (abandoned vehicle, overgrown lot, unpermitted construction) by dropping a pin. The location data:
- Links the violation to the correct parcel/property record
- Enables geographic clustering analysis (which neighborhoods have the most violations)
- Supports photo + location evidence capture in a single Flow

### Grants Management

A grant applicant identifies the project site — a community center, park, or infrastructure project — on the map. The location data:
- Validates the project is within the eligible geographic area
- Populates the site address on the grant application
- Enables map visualizations of where grant dollars are being invested

### Public Safety / Justice

An incident report or tip includes a map-picked location for:
- The scene of an incident
- A reported hazard or safety concern
- Community resource mapping (shelters, food banks, clinics)

### Transportation / Infrastructure

A resident reports a road issue, suggests a crosswalk location, or flags a dangerous intersection. The map pick:
- Captures the exact location on the road network
- Feeds into GIS systems for transportation planning
- Supports heat-map analysis of reported issues by corridor

### General Pattern

Any Salesforce Flow that captures a location benefits from this component. It replaces error-prone address typing with a visual, intuitive interaction. The outputs (lat, lng, street, city, state, zip) are standard text variables that work with any Salesforce object or integration.

---

## Dependencies

Everything is included in this repo — no external packages needed:

| Resource | What it is |
|----------|-----------|
| `leaflet.js` | Leaflet v1.9.4 — open-source map library (static resource) |
| `leaflet_css.css` | Leaflet v1.9.4 stylesheet (static resource) |

Map tiles come from CARTO's free CDN. Reverse geocoding comes from OpenStreetMap's Nominatim service. Both are free and require no API keys.

## Project Structure

```
carto-picker-lwc/
├── force-app/main/default/
│   ├── lwc/
│   │   └── cartoPicker/            ← The map picker component
│   └── staticresources/
│       ├── leaflet.js               ← Leaflet JS library
│       ├── leaflet.resource-meta.xml
│       ├── leaflet_css.css           ← Leaflet stylesheet
│       └── leaflet_css.resource-meta.xml
├── sfdx-project.json
└── README.md
```

## License

This project is provided as-is for demo and educational purposes. Leaflet is [BSD-2-Clause](https://github.com/Leaflet/Leaflet/blob/main/LICENSE). CARTO basemaps and OpenStreetMap data are subject to their respective terms of use.
