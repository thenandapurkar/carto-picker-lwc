import { LightningElement, api, track } from 'lwc';
import { FlowAttributeChangeEvent } from 'lightning/flowSupport';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import LEAFLET_JS from '@salesforce/resourceUrl/leaflet';
import LEAFLET_CSS from '@salesforce/resourceUrl/leaflet_css';

const COORD_DECIMAL_PLACES = 11;

/* User-friendly Flow picklist slug -> actual CartoDB CDN path.
 * The voyager family lives under /rastertiles/, the positron/dark_matter families
 * live at the root with their original CartoDB names (light_all, dark_all, etc). */
const STYLE_PATHS = {
    voyager: 'rastertiles/voyager',
    voyager_nolabels: 'rastertiles/voyager_nolabels',
    voyager_labels_under: 'rastertiles/voyager_labels_under',
    positron: 'light_all',
    positron_nolabels: 'light_nolabels',
    dark_matter: 'dark_all',
    dark_matter_nolabels: 'dark_nolabels'
};
const DEFAULT_STYLE = 'voyager';

function pathForStyle(style) {
    const key = String(style || '').toLowerCase().trim();
    return STYLE_PATHS[key] || STYLE_PATHS[DEFAULT_STYLE];
}

function tileUrlFor(style) {
    return `https://{s}.basemaps.cartocdn.com/${pathForStyle(style)}/{z}/{x}/{y}{r}.png`;
}

const MAP_ATTRIBUTION =
    '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

function formatCoord(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return '';
    }
    return n.toFixed(COORD_DECIMAL_PLACES);
}

function resolveLeafletGlobal(lwcTemplateRoot) {
    const win =
        lwcTemplateRoot?.ownerDocument?.defaultView ||
        (typeof document !== 'undefined' ? document.defaultView : null);

    return (
        win?.L ||
        win?.globalThis?.L ||
        globalThis.L ||
        (typeof globalThis.window !== 'undefined' && globalThis.window.L) ||
        (typeof globalThis.self !== 'undefined' && globalThis.self.L) ||
        undefined
    );
}

async function waitForLeafletGlobal(lwcTemplateRoot, maxAttempts = 24) {
    /* eslint-disable no-await-in-loop -- yield until injected Leaflet script attaches L to window */
    for (let i = 0; i < maxAttempts; i++) {
        const leaflet = resolveLeafletGlobal(lwcTemplateRoot);
        if (leaflet) {
            return leaflet;
        }
        await Promise.resolve();
    }
    /* eslint-enable no-await-in-loop */
    return undefined;
}

export default class CartoPicker extends LightningElement {
    @api inputLatitude = '39.7520';
    @api inputLongitude = '-104.9915';
    @api mapZoomLevel = 16;
    @api mapHeight = 500;
    @api mapStyle = DEFAULT_STYLE;

    _selectedLatitude = '';
    _selectedLongitude = '';
    _city = '';
    _state = '';
    _street = '';
    _postal = '';
    @track _fullStreetAddress = '';

    @track _statusMessage = '';
    @track _statusIsError = false;
    @track _confirmed = false;
    @track _mapReady = false;

    map;
    _marker = null;
    _resizeObserver;
    _initializing = false;
    _initFailed = false;
    _failureDetail = '';
    _geocodeTimer = null;

    @api get selectedLatitude() { return this._selectedLatitude; }
    set selectedLatitude(value) { this._selectedLatitude = value ?? ''; }

    @api get selectedLongitude() { return this._selectedLongitude; }
    set selectedLongitude(value) { this._selectedLongitude = value ?? ''; }

    @api get city() { return this._city; }
    set city(value) { this._city = value ?? ''; }

    @api get state() { return this._state; }
    set state(value) { this._state = value ?? ''; }

    @api get street() { return this._street; }
    set street(value) { this._street = value ?? ''; }

    @api get postal() { return this._postal; }
    set postal(value) { this._postal = value ?? ''; }

    @api get fullStreetAddress() { return this._fullStreetAddress; }
    set fullStreetAddress(value) { this._fullStreetAddress = value ?? ''; }

    get containerStyle() {
        const h = Number(this.mapHeight);
        const heightPx = Number.isFinite(h) && h > 0 ? h : 500;
        return `height: ${heightPx}px; min-height: ${heightPx}px; width: 100%;`;
    }

    get showStatusBanner() {
        return Boolean(this._statusMessage && String(this._statusMessage).trim());
    }
    get statusMessage() { return this._statusMessage; }
    get statusBannerClass() {
        return this._statusIsError ? 'status-banner status-banner--error' : 'status-banner';
    }

    get isConfirmed() { return this._confirmed; }
    get showCrosshair() { return this._mapReady && !this._confirmed; }
    get showBottomBar() { return this._mapReady; }

    setStatus(message, isError) {
        this._statusMessage = message || '';
        this._statusIsError = Boolean(isError);
    }

    disconnectedCallback() {
        this.teardownResizeObserver();
        if (this._geocodeTimer) {
            clearTimeout(this._geocodeTimer);
            this._geocodeTimer = null;
        }
        this.removeMarker();
        if (this.map) {
            this.map.remove();
            this.map = undefined;
        }
        this._mapReady = false;
        this._confirmed = false;
        this._initializing = false;
        this._initFailed = false;
        this._failureDetail = '';
    }

    removeMarker() {
        if (this._marker && this.map) {
            try {
                this.map.removeLayer(this._marker);
            } catch (e) {
                /* noop */
            }
        }
        this._marker = null;
    }

    createPinIcon() {
        const L = resolveLeafletGlobal(this.template);
        if (!L) {
            return null;
        }
        /* Inline every style: LWC scoped CSS + LWS make external class selectors
         * unreliable for DOM that Leaflet injects after render. Inline styles
         * always apply. Keyframes can't be inlined, so the drop-in animation lives
         * in the JS-injected <style> tag instead (see ensurePinStylesheet). */
        const html =
            '<div style="' +
                'position:absolute;left:2px;top:0;width:28px;height:28px;' +
                'background:#1b96ff;border:3px solid #ffffff;' +
                'border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
                'box-shadow:0 4px 8px rgba(0,0,0,0.3),0 1px 2px rgba(0,0,0,0.2);' +
                'animation:cpPinDrop 320ms cubic-bezier(0.2,0.7,0.2,1) both;' +
            '">' +
                '<div style="' +
                    'position:absolute;top:50%;left:50%;width:8px;height:8px;' +
                    'background:#ffffff;border-radius:50%;' +
                    'transform:translate(-50%,-50%) rotate(45deg);' +
                '"></div>' +
            '</div>' +
            '<div style="' +
                'position:absolute;left:8px;top:36px;width:16px;height:5px;' +
                'background:rgba(0,0,0,0.25);border-radius:50%;filter:blur(1.5px);' +
                'animation:cpPinShadow 320ms cubic-bezier(0.2,0.7,0.2,1) both;' +
            '"></div>';
        return L.divIcon({
            className: 'cp-pin-icon',
            html,
            iconSize: [32, 44],
            iconAnchor: [16, 40]
        });
    }

    /* @keyframes can't live inline on elements, so inject a stylesheet into the
     * document head exactly once. Document-level CSS is not subject to LWC scoping
     * or LWS rewriting, so the animation names referenced by the inline styles will
     * always resolve. */
    ensurePinStylesheet() {
        if (typeof document === 'undefined') {
            return;
        }
        if (document.getElementById('cp-pin-keyframes')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'cp-pin-keyframes';
        style.textContent =
            '@keyframes cpPinDrop {' +
                '0%{transform:rotate(-45deg) translateY(-32px) scale(0.85);opacity:0}' +
                '60%{transform:rotate(-45deg) translateY(0) scale(1.05);opacity:1}' +
                '100%{transform:rotate(-45deg) translateY(0) scale(1);opacity:1}' +
            '}' +
            '@keyframes cpPinShadow {' +
                '0%{transform:scale(0.4);opacity:0}' +
                '60%{transform:scale(1.1);opacity:0.85}' +
                '100%{transform:scale(1);opacity:1}' +
            '}' +
            '@media (prefers-reduced-motion: reduce){' +
                '.cp-pin-icon *{animation:none !important}' +
            '}';
        document.head.appendChild(style);
    }

    teardownResizeObserver() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = undefined;
        }
    }

    setupResizeObserver(container) {
        this.teardownResizeObserver();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        this._resizeObserver = new ResizeObserver(() => {
            if (this.map) {
                this.map.invalidateSize();
            }
        });
        const wrapper = this.template.querySelector('.map-wrapper');
        if (wrapper) {
            this._resizeObserver.observe(wrapper);
        }
        this._resizeObserver.observe(container);
    }

    fireFlowOutput(apiName, value) {
        const v = value ?? '';
        switch (apiName) {
            case 'selectedLatitude': this._selectedLatitude = v; break;
            case 'selectedLongitude': this._selectedLongitude = v; break;
            case 'city': this._city = v; break;
            case 'state': this._state = v; break;
            case 'street': this._street = v; break;
            case 'postal': this._postal = v; break;
            case 'fullStreetAddress': this._fullStreetAddress = v; break;
            default: break;
        }
        this.dispatchEvent(new FlowAttributeChangeEvent(apiName, v));
    }

    async renderedCallback() {
        if (this.map) {
            return;
        }
        if (this._initializing || this._initFailed) {
            return;
        }

        this._initializing = true;
        this.setStatus('Loading map\u2026', false);

        try {
            await Promise.all([loadStyle(this, LEAFLET_CSS), loadScript(this, LEAFLET_JS)]);
        } catch (e) {
            console.error('cartoPicker: failed to load Leaflet resources', e);
            this._initFailed = true;
            this._failureDetail =
                'Could not load Leaflet from static resources. Confirm leaflet and leaflet_css are deployed.';
            this.setStatus(this._failureDetail, true);
            this._initializing = false;
            return;
        }

        const L = await waitForLeafletGlobal(this.template);
        if (!L) {
            console.error('cartoPicker: Leaflet (L) is undefined after loadScript.');
            this._initFailed = true;
            this._failureDetail = 'Map library did not become available after loading.';
            this.setStatus(this._failureDetail, true);
            this._initializing = false;
            return;
        }

        const container = this.template.querySelector('.map-container');
        if (!container) {
            console.error('cartoPicker: map container not found');
            this._initFailed = true;
            this._failureDetail = 'Internal error: map container missing.';
            this.setStatus(this._failureDetail, true);
            this._initializing = false;
            return;
        }

        const lat = parseFloat(this.inputLatitude);
        const lng = parseFloat(this.inputLongitude);
        const zoomRaw = Number(this.mapZoomLevel);
        const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 16;

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            this._initFailed = true;
            this._failureDetail = 'Input latitude or longitude is not a valid number.';
            this.setStatus(this._failureDetail, true);
            this._initializing = false;
            return;
        }

        try {
            this.map = L.map(container, {
                zoomControl: true,
                attributionControl: true
            }).setView([lat, lng], zoom);

            /* No crossOrigin: CartoDB tiles don't always send Access-Control-Allow-Origin
             * for plain image requests, and we never need to read pixel data from a canvas. */
            L.tileLayer(tileUrlFor(this.mapStyle), {
                attribution: MAP_ATTRIBUTION,
                subdomains: 'abcd',
                maxZoom: 20,
                detectRetina: true
            }).addTo(this.map);

            this.map.on('moveend', () => {
                if (this._confirmed) {
                    return;
                }
                this.onCenterChanged();
            });

            this.setupResizeObserver(container);
            if (this.map) {
                this.map.invalidateSize();
            }

            this.setStatus('', false);
            this._initFailed = false;
            this._failureDetail = '';

            /* Defer overlay render + Flow outputs until after this render cycle (Leaflet mutates manual DOM). */
            Promise.resolve().then(() => {
                if (!this.map) {
                    return;
                }
                this._mapReady = true;
                this.onCenterChanged();
            });
        } catch (e) {
            console.error('cartoPicker: failed to initialize Leaflet map', e);
            this._initFailed = true;
            this._failureDetail =
                e?.message || 'Failed to start the map. Check the browser console.';
            this.setStatus(this._failureDetail, true);
            this._mapReady = false;
            if (this.map) {
                this.map.remove();
                this.map = undefined;
            }
        }

        this._initializing = false;
    }

    onCenterChanged() {
        if (!this.map) {
            return;
        }
        const center = this.map.getCenter();
        this.fireFlowOutput('selectedLatitude', formatCoord(center.lat));
        this.fireFlowOutput('selectedLongitude', formatCoord(center.lng));

        if (this._geocodeTimer) {
            clearTimeout(this._geocodeTimer);
        }
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._geocodeTimer = setTimeout(() => {
            this._geocodeTimer = null;
            this.reverseGeocode(center.lat, center.lng);
        }, 400);
    }

    handleConfirm() {
        this._confirmed = true;
        if (!this.map) {
            return;
        }
        const L = resolveLeafletGlobal(this.template);
        const center = this.map.getCenter();
        if (L && center) {
            this.ensurePinStylesheet();
            this.removeMarker();
            const icon = this.createPinIcon();
            const opts = icon ? { icon, keyboard: false, interactive: false } : { keyboard: false, interactive: false };
            this._marker = L.marker([center.lat, center.lng], opts).addTo(this.map);
        }
        this.map.dragging.disable();
        this.map.touchZoom.disable();
        this.map.doubleClickZoom.disable();
        this.map.scrollWheelZoom.disable();
        this.map.boxZoom.disable();
        this.map.keyboard.disable();
    }

    handleReset() {
        this._confirmed = false;
        this.removeMarker();
        if (this.map) {
            this.map.dragging.enable();
            this.map.touchZoom.enable();
            this.map.doubleClickZoom.enable();
            this.map.scrollWheelZoom.enable();
            this.map.boxZoom.enable();
            this.map.keyboard.enable();
        }
    }

    /* Reverse geocode via Nominatim (OpenStreetMap). Free, no API key.
     * Respect their usage policy: max 1 req/sec; 400ms debounce keeps us under the limit. */
    async reverseGeocode(lat, lng) {
        try {
            const url =
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
                `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}` +
                `&zoom=18&addressdetails=1`;
            const res = await fetch(url, {
                headers: { Accept: 'application/json' },
                referrerPolicy: 'origin'
            });
            if (!res.ok) {
                console.error('cartoPicker: geocoding HTTP error', res.status);
                return;
            }
            const data = await res.json();
            if (!data || !data.address) {
                this.fireFlowOutput('fullStreetAddress', '');
                this.fireFlowOutput('street', '');
                this.fireFlowOutput('city', '');
                this.fireFlowOutput('state', '');
                this.fireFlowOutput('postal', '');
                return;
            }

            const addr = data.address;
            const street = [addr.house_number, addr.road].filter(Boolean).join(' ').trim();
            const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || '';
            const state = addr.state || addr.region || '';
            const postal = addr.postcode || '';

            this.fireFlowOutput('fullStreetAddress', data.display_name || '');
            this.fireFlowOutput('street', street);
            this.fireFlowOutput('city', city);
            this.fireFlowOutput('state', state);
            this.fireFlowOutput('postal', postal);
        } catch (e) {
            console.error('cartoPicker: reverse geocode error', e);
        }
    }
}