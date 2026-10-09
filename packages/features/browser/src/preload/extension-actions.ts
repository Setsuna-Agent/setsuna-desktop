import { initializeUserScripts } from './user-scripts.js';
import { initializeExtensionTabs } from './extension-tabs.js';
import { initializeExtensionUi } from './extension-ui.js';
import { initializeExtensionSystem } from './extension-system.js';

/** Runs before extension scripts, including native MV2 pages and MV3 workers. */
initializeExtensionTabs();
initializeExtensionUi();
initializeExtensionSystem();
initializeUserScripts();
