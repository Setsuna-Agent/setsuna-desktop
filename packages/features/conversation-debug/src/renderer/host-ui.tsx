import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

type ConversationDebugUi = Readonly<{
  CodeView: ElementType<{
    'aria-label'?: string;
    className?: string;
    code: string;
    language: string;
  }>;
  EmptyState: ElementType<{ title: string; body?: string }>;
  IconButton: ElementType<ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    label: string;
  }>;
  ResizeHandle: ElementType<{
    max: number;
    min: number;
    onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onResizeStep: (delta: number) => void;
    value: number;
  }>;
  SelectField: ElementType<{
    'aria-label'?: string;
    children: ReactNode;
    className?: string;
    disabled?: boolean;
    onValueChange: (value: string) => boolean | void;
    value: string;
  }>;
}>;

const ConversationDebugUiContext = createContext<ConversationDebugUi | null>(null);

export function ConversationDebugUiProvider({
  children,
  ui,
}: Readonly<{
  children: ReactNode;
  ui: ConversationDebugUi;
}>) {
  return (
    <ConversationDebugUiContext.Provider value={ui}>
      {children}
    </ConversationDebugUiContext.Provider>
  );
}

export function useConversationDebugUi(): ConversationDebugUi {
  const value = useContext(ConversationDebugUiContext);
  if (!value) throw new Error('ConversationDebugUiProvider is missing.');
  return value;
}
