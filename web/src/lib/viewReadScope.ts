import { createContext, useContext } from 'react';

/** Identity and server generations only. Responses remain in the bounded memory-only cache. */
export const ViewReadScopeContext = createContext<string | null>(null);
export const useViewReadScope = () => useContext(ViewReadScopeContext);
