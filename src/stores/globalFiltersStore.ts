/**
 * Global Filters Store - Single Source of Truth for Dashboard Context
 * All admin pages must respect these filters (date, org, zone)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface GlobalFiltersState {
  // Date Range
  dateFrom: string; // ISO date string
  dateTo: string;   // ISO date string
  datePreset: 'today' | 'yesterday' | 'week' | 'month' | 'custom';
  
  // Organization Filter
  organizationId: string | null; // null = "All Organizations"
  organizationName: string | null;
  
  // Zone Filter
  zoneId: string | null; // null = "All Zones"
  zoneName: string | null;
  
  // Actions
  setDateRange: (from: string, to: string, preset?: 'today' | 'yesterday' | 'week' | 'month' | 'custom') => void;
  setToday: () => void;
  setYesterday: () => void;
  setPrevDay: () => void;
  setNextDay: () => void;
  setOrganization: (id: string | null, name: string | null) => void;
  setZone: (id: string | null, name: string | null) => void;
  reset: () => void;
}

const getToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString().split('T')[0];
};

const getYesterday = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return yesterday.toISOString().split('T')[0];
};

const addDays = (dateStr: string, days: number) => {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};

export const useGlobalFilters = create<GlobalFiltersState>()(
  persist(
    (set) => ({
      // Initial state: Today
      dateFrom: getToday(),
      dateTo: getToday(),
      datePreset: 'today',
      organizationId: null,
      organizationName: null,
      zoneId: null,
      zoneName: null,

      setDateRange: (from, to, preset = 'custom') => {
        set({ dateFrom: from, dateTo: to, datePreset: preset });
      },

      setToday: () => {
        const today = getToday();
        set({ dateFrom: today, dateTo: today, datePreset: 'today' });
      },

      setYesterday: () => {
        const yesterday = getYesterday();
        set({ dateFrom: yesterday, dateTo: yesterday, datePreset: 'yesterday' });
      },

      setPrevDay: () => {
        set((state) => {
          const newFrom = addDays(state.dateFrom, -1);
          const newTo = addDays(state.dateTo, -1);
          return { dateFrom: newFrom, dateTo: newTo, datePreset: 'custom' };
        });
      },

      setNextDay: () => {
        set((state) => {
          const newFrom = addDays(state.dateFrom, 1);
          const newTo = addDays(state.dateTo, 1);
          return { dateFrom: newFrom, dateTo: newTo, datePreset: 'custom' };
        });
      },

      setOrganization: (id, name) => {
        set({ organizationId: id, organizationName: name });
      },

      setZone: (id, name) => {
        set({ zoneId: id, zoneName: name });
      },

      reset: () => {
        const today = getToday();
        set({
          dateFrom: today,
          dateTo: today,
          datePreset: 'today',
          organizationId: null,
          organizationName: null,
          zoneId: null,
          zoneName: null,
        });
      },
    }),
    {
      name: 'global-filters-storage',
    }
  )
);
