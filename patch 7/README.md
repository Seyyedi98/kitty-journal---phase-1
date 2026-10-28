# Kitty Journal — Expo / React Native starter

This is the updated native-first Kitty Journal foundation. The mobile UI has been rebuilt to closely follow the visual system of the original Next.js + Capacitor prototype, using React Native, SVG illustration, Lucide icons, and Reanimated transitions.

## Requirements
- Node.js 22.13 or newer recommended for Expo SDK 57
- npm
- Expo Go compatible with SDK 57 for a quick Android preview

## Run on Android without Android Studio
1. Extract this ZIP.
2. Open a terminal in the `kitty-journal-expo` folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start Metro with a clean cache:
   ```bash
   npx expo start --clear
   ```
5. Open Expo Go on your Android phone and scan the QR code. If LAN discovery fails, try `npx expo start --tunnel`.

The phone and computer should normally be on the same Wi-Fi network when using LAN mode.

## What changed in this update
- Replaced deprecated React Native `SafeAreaView` with `react-native-safe-area-context` insets.
- Added top inset handling so the header does not render underneath the Android status bar.
- Recreated the original cat artwork as a native SVG and use Lucide React Native icons.
- Added a floating, pill-shaped animated dock with smooth active-tab label expansion using Reanimated.
- Kept the dock horizontal on phones (including phone landscape); tablet landscape uses a compact vertical rail.
- Tablet layouts use wider margins and a two-column Home screen in portrait and landscape.
- Added the missing weekday header row to the calendar.
- Implemented a true Solar Hijri month grid and Gregorian month grid using the same calendar conversion helpers as the web prototype.
- Search stays focused while typing; the Home screen component is stable and the scroll view keeps taps from dismissing the keyboard.
- Search with no matches shows a dedicated no-results state rather than the first-entry empty state.
- Added DM Sans and Vazirmatn font assets for closer visual parity with the web prototype.
- Added small entrance animations for Home sections.
- Daily moods are persisted separately in SQLite, independent from entry moods.

## Current scope
The app has local SQLite entry storage, entry-level moods and favorites, daily mood persistence, search, calendar navigation, appearance/language settings, Memories and Insights starter screens, and an entry editor. Memories images/map, reminders, reliable export/import, app lock, cloud sync, premium entitlements, and production QA remain future work.

## Notes
- This ZIP is a project source archive, not an APK.
- The app uses Expo SDK 57, React Native 0.86, and JavaScript (not TypeScript).
- The Solar Hijri calendar conversion helpers were carried over from the original web prototype. Verify representative leap-year and year-boundary dates on device before release.
- The font packages are bundled dependencies; fonts do not need to be fetched at runtime.
