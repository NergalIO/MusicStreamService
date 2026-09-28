import { createContext, useContext, type RefObject } from 'react';

export const ScrollContainerContext = createContext<RefObject<HTMLElement> | null>(null);

export function useScrollContainer(): RefObject<HTMLElement> | null {
  return useContext(ScrollContainerContext);
}
