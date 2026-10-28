import React from 'react';

export const safeArea = {
  __esModule: true,
  SafeAreaProvider: ({ children }) => <>{children}</>,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
};
export const statusBar = { __esModule: true, StatusBar: () => null };
export const font = { __esModule: true, useFonts: () => [true] };
export const fontPack = new Proxy({}, { get: (_t, n) => (n === '__esModule' ? true : String(n)) });

export function Dock({ activeTab, onTabPress, labels }) {
  return (
    <div data-testid="dock" style={{ display: 'flex', flexDirection: 'row' }}>
      {['home', 'calendar', 'memories', 'insights', 'settings'].map((k) => (
        <button key={k} aria-label={`tab-${k}`} aria-pressed={String(activeTab === k)} onClick={() => onTabPress(k)}>
          {labels[k]}
        </button>
      ))}
    </div>
  );
}
export default function CatIllustration() { return null; }
