/**
 * The store instance, so screens can reach it without threading it through every prop.
 *
 * Deliberately separate from the plan state: `PlanProvider` owns the working copy, this owns
 * the thing that reads and writes it. Swapping the fixture store for Supabase is a change here
 * and in `main.tsx`, nowhere else.
 */

import { createContext, useContext } from 'react';

import type { PlanStore } from './persistence/types.ts';

export const StoreContext = createContext<PlanStore | null>(null);

export function useStore(): PlanStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore doit etre appele dans un StoreContext.Provider');
  return store;
}
