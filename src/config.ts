import { Config } from './types';
import pulteHomesLogo from './assets/images/PulteHomes.png';
import perryHomesLogo from './assets/images/PerryHomes.png';

export const CONFIG: Config = {
    // The current commentary feed is ball-id based, so a short timeout chain gives OBS a
    // near-live update without ever overlapping a slow request.
    REFRESH_RATE: 1500,
    DEFAULT_CLUB_ID: '1089463', // LPCL
    // Imported so Vite copies and hashes the files into dist/ and resolves the
    // URL relative to the deployed base (a plain '../assets/...' path 404s on
    // GitHub Pages because Vite never copies files outside src/ or public/).
    LOGO_MAP: {
        '1': pulteHomesLogo,
        '2': perryHomesLogo,
    },
    ANALYTICS_ENDPOINT: '/api/collect',
};
