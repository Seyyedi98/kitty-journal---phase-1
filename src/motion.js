// One place for every animation in the app, built on react-native-reanimated.
// - Honors the system "reduce motion" setting (animations become instant).
// - Every reanimated feature is looked up defensively, so an older/newer
//   reanimated that lacks one simply skips that animation instead of crashing.
import React, { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import * as R from 'react-native-reanimated';

const Animated = R.default;
export { Animated };

let reduced = false;
try {
  AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
    reduced = Boolean(v);
  });
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => {
    reduced = Boolean(v);
  });
} catch {
  /* keep animations on */
}

const build = (name, ...steps) => {
  if (reduced) return undefined;
  try {
    let b = R[name];
    if (!b) return undefined;
    for (const [method, arg] of steps) {
      if (typeof b[method] !== 'function') return b;
      b = b[method](arg);
    }
    return b;
  } catch {
    return undefined;
  }
};

/** Entering animations. `delay` staggers siblings. */
export const fadeInDown = (delay = 0, duration = 380) => build('FadeInDown', ['delay', delay], ['duration', duration]);
export const fadeIn = (delay = 0, duration = 260) => build('FadeIn', ['delay', delay], ['duration', duration]);
export const zoomIn = (delay = 0, duration = 260) => build('ZoomIn', ['delay', delay], ['duration', duration]);
export const slideInUp = () => build('SlideInDown', ['duration', 260]);
export const slideOutDown = () => build('SlideOutDown', ['duration', 200]);
export const fadeOut = () => build('FadeOut', ['duration', 160]);
/** Smooth re-layout when list items appear / disappear / move. */
export const listLayout = () => (reduced ? undefined : R.LinearTransition || R.Layout || undefined);
/** Stagger helper: later items wait a little longer, capped so long lists stay snappy. */
export const stagger = (index, step = 45, max = 8) => Math.min(index, max) * step;

/** A Pressable that gently shrinks while pressed. Drop-in replacement. */
const AnimatedPressable = Animated.createAnimatedComponent ? Animated.createAnimatedComponent(Pressable) : Pressable;

// Style keys that position/size the component inside its parent. When an
// entering/layout animation is requested these go on a wrapper view: reanimated
// must not share a component with the press-scale `transform`.
const OUTER_KEYS = new Set([
  'position', 'top', 'bottom', 'left', 'right', 'start', 'end', 'zIndex',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
]);

export function PressableScale({ style, onPressIn, onPressOut, scaleTo = 0.965, entering, exiting, layout, ...props }) {
  const scale = R.useSharedValue(1);
  const animated = R.useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pressable = (innerStyle) => (
    <AnimatedPressable
      {...props}
      onPressIn={(e) => {
        if (!reduced) scale.value = R.withSpring(scaleTo, { damping: 18, stiffness: 320 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduced) scale.value = R.withSpring(1, { damping: 14, stiffness: 260 });
        onPressOut?.(e);
      }}
      style={[innerStyle, animated]}
    />
  );
  if (!entering && !exiting && !layout) return pressable(style);

  const flat = StyleSheet.flatten(style) || {};
  const outer = {};
  const inner = {};
  for (const [k, v] of Object.entries(flat)) (OUTER_KEYS.has(k) ? outer : inner)[k] = v;
  // The pressable fills the wrapper along any axis the wrapper sizes explicitly.
  if (outer.width !== undefined) inner.width = '100%';
  if (outer.height !== undefined) inner.height = '100%';
  if (outer.flex !== undefined) inner.flex = 1;
  return (
    <Animated.View entering={entering} exiting={exiting} layout={layout} style={outer}>
      {pressable(inner)}
    </Animated.View>
  );
}

/** Wrapper that "pops" when `active` becomes true (e.g. a selected mood face). */
export function Pop({ active, children, style }) {
  const scale = R.useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    if (active) scale.value = R.withSequence(R.withSpring(1.28, { damping: 8, stiffness: 400 }), R.withSpring(1, { damping: 10, stiffness: 240 }));
    else scale.value = R.withTiming(1, { duration: 120 });
  }, [active, scale]);
  const animated = R.useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** A horizontal bar whose fill grows from 0 to `fraction` (0..1) of the track. */
export function GrowBar({ fraction, trackWidth, height = 8, color, rtl, delay = 0 }) {
  const progress = R.useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    progress.value = reduced ? 1 : R.withDelay ? R.withDelay(delay, R.withTiming(1, { duration: 700 })) : R.withTiming(1, { duration: 700 });
  }, [fraction, delay, progress]);
  const animated = R.useAnimatedStyle(() => ({ width: Math.max(0, trackWidth * fraction * progress.value) }));
  return (
    <Animated.View
      style={[{ height, borderRadius: height / 2, backgroundColor: color, alignSelf: rtl ? 'flex-end' : 'flex-start' }, animated]}
    />
  );
}
