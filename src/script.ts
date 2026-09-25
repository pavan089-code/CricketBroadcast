import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './css/instructions.css';
import './css/scorecard.css';
import { setupLinkStreamForm, pollLoop, stopPolling } from './app';
import { setupUrlBuilder } from './urlBuilder';

setupUrlBuilder();
setupLinkStreamForm();
pollLoop();
window.addEventListener('pagehide', stopPolling, { once: true });
