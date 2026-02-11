/**
 * Dark Mode Hook - Manual dark mode toggle with localStorage persistence
 * Allows staff to override system preferences for night shift work
 */

import { useState, useEffect } from 'react';

type DarkModePreference = 'light' | 'dark' | 'system';

export function useDarkMode() {
  const [preference, setPreference] = useState<DarkModePreference>(() => {
    // Load saved preference or default to system
    const saved = localStorage.getItem('dark-mode-preference') as DarkModePreference;
    return saved || 'system';
  });

  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const applyDarkMode = () => {
      let shouldBeDark = false;

      if (preference === 'system') {
        // Follow system preference
        shouldBeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      } else {
        // Use manual preference
        shouldBeDark = preference === 'dark';
      }

      setIsDark(shouldBeDark);

      // Apply to document
      if (shouldBeDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyDarkMode();

    // Listen for system preference changes (only if using system mode)
    if (preference === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyDarkMode();
      
      // Modern browsers
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
      }
      // Legacy browsers
      else if (mediaQuery.addListener) {
        mediaQuery.addListener(handler);
        return () => mediaQuery.removeListener(handler);
      }
    }
  }, [preference]);

  const setDarkModePreference = (newPreference: DarkModePreference) => {
    setPreference(newPreference);
    localStorage.setItem('dark-mode-preference', newPreference);
  };

  const toggleDarkMode = () => {
    setDarkModePreference(isDark ? 'light' : 'dark');
  };

  return {
    preference,
    isDark,
    setPreference: setDarkModePreference,
    toggle: toggleDarkMode,
  };
}
