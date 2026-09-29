import { createContext } from 'react';

/** Portalled menus still bubble React events through their sidebar row. */
export const SidebarMenuOpenContext = createContext(false);
