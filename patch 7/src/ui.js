import React from 'react';
import {
  ScrollView as NativeScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
} from 'react-native';

// Font selection depends on the active language. Kept in module state so the
// drop-in Text / TextInput wrappers need no extra props anywhere in the app.
let ACTIVE_LANGUAGE = 'en';
let ACTIVE_FONTS_LOADED = false;

export function setUiLanguage(language) {
  ACTIVE_LANGUAGE = language;
}
export function setUiFontsLoaded(loaded) {
  ACTIVE_FONTS_LOADED = loaded;
}

const LATIN = {
  400: 'DMSans_400Regular',
  500: 'DMSans_500Medium',
  600: 'DMSans_600SemiBold',
  700: 'DMSans_700Bold',
  800: 'DMSans_700Bold',
};
export const FONT_FAMILIES = {
  en: LATIN,
  tr: LATIN,
  fa: {
    400: 'Vazirmatn_400Regular',
    500: 'Vazirmatn_500Medium',
    600: 'Vazirmatn_600SemiBold',
    700: 'Vazirmatn_700Bold',
    800: 'Vazirmatn_700Bold',
  },
};

export function Text({ style, ...props }) {
  const flattened = StyleSheet.flatten(style) || {};
  const weight = String(flattened.fontWeight || '400');
  const family = FONT_FAMILIES[ACTIVE_LANGUAGE] || FONT_FAMILIES.en;
  const fontFamily = flattened.fontFamily || (ACTIVE_FONTS_LOADED ? family[weight] || family['400'] : undefined);
  return (
    <NativeText
      maxFontSizeMultiplier={1.5}
      {...props}
      style={[fontFamily ? { fontFamily } : null, style]}
    />
  );
}

export function TextInput(props) {
  const flattened = StyleSheet.flatten(props.style) || {};
  const family = FONT_FAMILIES[ACTIVE_LANGUAGE] || FONT_FAMILIES.en;
  const fontFamily = flattened.fontFamily || (ACTIVE_FONTS_LOADED ? family['400'] : undefined);
  return (
    <NativeTextInput
      maxFontSizeMultiplier={1.5}
      {...props}
      style={[fontFamily ? { fontFamily } : null, props.style]}
    />
  );
}

/**
 * Drop-in ScrollView with both scroll indicators permanently hidden
 * (scrolling itself is unchanged). Use this instead of react-native's.
 */
export function ScrollView(props) {
  return (
    <NativeScrollView
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      {...props}
    />
  );
}
