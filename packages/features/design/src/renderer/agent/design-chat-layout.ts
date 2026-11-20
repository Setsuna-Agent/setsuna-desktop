import { createContext } from 'react';

export const DesignChatPanelContext = createContext<{ visible: boolean; showCanvas?(): void }>({ visible: true });
export const DesignChatFullscreenContext = createContext(false);
