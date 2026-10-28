// DOM stand-ins for react-native so the real components can run in a browser.
import React from 'react';

const flat = (style) => {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return style;
};
const px = (v) => (typeof v === 'number' ? `${v}px` : v);
const NUMERIC_NO_PX = new Set(['flex', 'flexGrow', 'flexShrink', 'opacity', 'fontWeight', 'zIndex', 'lineHeight']);

export function toCss(style) {
  const f = flat(style);
  const out = { display: 'flex', flexDirection: 'column', boxSizing: 'border-box' };
  for (const [k, v] of Object.entries(f)) {
    if (v == null || typeof v === 'object') continue;
    if (k === 'paddingHorizontal') { out.paddingLeft = px(v); out.paddingRight = px(v); }
    else if (k === 'paddingVertical') { out.paddingTop = px(v); out.paddingBottom = px(v); }
    else if (k === 'marginHorizontal') { out.marginLeft = px(v); out.marginRight = px(v); }
    else if (k === 'marginVertical') { out.marginTop = px(v); out.marginBottom = px(v); }
    else if (k === 'elevation' || k === 'shadowOpacity' || k === 'shadowRadius' || k === 'shadowColor' || k === 'textAlignVertical' || k === 'letterSpacing') continue;
    else out[k] = NUMERIC_NO_PX.has(k) ? v : px(v);
  }
  return out;
}

const a11y = (p) => ({
  'aria-label': p.accessibilityLabel,
  role: p.accessibilityRole === 'button' ? 'button' : undefined,
  'aria-selected': p.accessibilityState && p.accessibilityState.selected != null ? String(p.accessibilityState.selected) : undefined,
  'data-testid': p.testID,
});

export const View = React.forwardRef(function View({ style, children, ...p }, ref) {
  return <div ref={ref} style={toCss(style)} {...a11y(p)}>{children}</div>;
});

export const Text = React.forwardRef(function Text({ style, children, numberOfLines, ...p }, ref) {
  return <span ref={ref} style={{ ...toCss(style), display: 'inline' }} {...a11y(p)}>{children}</span>;
});

export const Pressable = React.forwardRef(function Pressable({ style, children, onPress, disabled, ...p }, ref) {
  const s = typeof style === 'function' ? style({ pressed: false }) : style;
  return (
    <div ref={ref} tabIndex={0} onClick={disabled ? undefined : onPress} style={{ ...toCss(s), cursor: 'pointer' }} data-disabled={disabled ? 'true' : undefined} {...a11y(p)}>
      {typeof children === 'function' ? children({ pressed: false }) : children}
    </div>
  );
});

export const TextInput = React.forwardRef(function TextInput({ style, value, onChangeText, onSubmitEditing, multiline, placeholder, ...p }, ref) {
  const common = {
    ref,
    value: value ?? '',
    placeholder,
    style: { ...toCss(style), display: 'block' },
    onChange: (e) => onChangeText && onChangeText(e.target.value),
    onKeyDown: (e) => { if (e.key === 'Enter' && !multiline && onSubmitEditing) onSubmitEditing(); },
    ...a11y(p),
  };
  return multiline ? <textarea {...common} /> : <input {...common} />;
});

export const ScrollView = React.forwardRef(function ScrollView({ style, contentContainerStyle, children, horizontal }, ref) {
  React.useImperativeHandle(ref, () => ({ scrollTo() {}, scrollToEnd() {} }));
  const explicitDirection = flat(contentContainerStyle).flexDirection;
  return (
    <div style={{ ...toCss(style), overflow: 'auto', flex: 1 }}>
      <div style={{ ...toCss(contentContainerStyle), flexDirection: explicitDirection || (horizontal ? 'row' : 'column') }}>{children}</div>
    </div>
  );
});

export function Modal({ visible, children }) {
  return visible ? <div data-modal="true" style={{ display: 'flex', flexDirection: 'column' }}>{children}</div> : null;
}
export const KeyboardAvoidingView = View;
export function Image({ source, style, ...p }) {
  return <img src={source && source.uri} style={toCss(style)} {...a11y(p)} />;
}
export function ActivityIndicator() { return <span data-spinner="true" />; }
export function Switch({ value, onValueChange, disabled, ...p }) {
  return <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onValueChange(e.target.checked)} {...a11y(p)} />;
}

export const StyleSheet = {
  create: (o) => o,
  flatten: flat,
  hairlineWidth: 1,
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
};
export const Platform = { OS: 'android', select: (o) => (o.android !== undefined ? o.android : o.default) };

export const alerts = [];
export const Alert = {
  alert(title, message, buttons) {
    alerts.push({ title, message, buttons });
    window.__alerts = alerts;
  },
};

const appStateListeners = new Set();
export const AppState = {
  currentState: 'active',
  addEventListener: (_t, fn) => { appStateListeners.add(fn); return { remove: () => appStateListeners.delete(fn) }; },
};
window.__setAppState = (s) => appStateListeners.forEach((fn) => fn(s));

const backListeners = [];
export const BackHandler = {
  addEventListener: (_t, fn) => { backListeners.push(fn); return { remove: () => { const i = backListeners.indexOf(fn); if (i >= 0) backListeners.splice(i, 1); } }; },
};
// Android dispatches Back to the most recently added listener first.
window.__pressBack = () => { for (let i = backListeners.length - 1; i >= 0; i--) if (backListeners[i]()) return true; return false; };

export const Linking = {
  opened: [],
  canOpenURL: async () => true,
  openURL: async (u) => { Linking.opened.push(u); window.__opened = Linking.opened; },
};
export const useColorScheme = () => 'light';
export const useWindowDimensions = () => { const [d, setD] = React.useState({ width: innerWidth, height: innerHeight }); React.useEffect(() => { const f = () => setD({ width: innerWidth, height: innerHeight }); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []); return { ...d, scale: 2, fontScale: 1 }; };
export const I18nManager = { isRTL: false };
export const AccessibilityInfo = { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) };
