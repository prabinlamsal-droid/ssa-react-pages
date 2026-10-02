import { createBrowserClient } from './browser.js';
import configuration from 'virtual:arcbridge-browser-config';
export const ssa = createBrowserClient(configuration);
if (import.meta.hot) import.meta.hot.dispose(() => ssa.dispose());
