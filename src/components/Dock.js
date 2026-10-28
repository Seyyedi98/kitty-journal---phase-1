import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  Home,
  CalendarDays,
  Heart,
  ChartNoAxesColumn,
  Settings2,
} from "lucide-react-native";
import { uiFont } from "../ui";
import { PressableScale } from "../motion";

const TABS = [
  { id: "home", key: "home", label: "Home", Icon: Home },
  { id: "calendar", key: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "memories", key: "memories", label: "Memories", Icon: Heart },
  {
    id: "insights",
    key: "insights",
    label: "Insights",
    Icon: ChartNoAxesColumn,
  },
];
const VERTICAL_TABS = [
  ...TABS,
  { id: "settings", key: "settings", label: "Settings", Icon: Settings2 },
];
const BROWN = "#8B5A2B";
const ICON_SIZE = 46;
const LABEL_MAX_WIDTH = 88;
const DURATION = 260;

function AnimatedTab({ tab, active, onPress, colors, compact = false, label, rtl = false }) {
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: DURATION });
  }, [active, progress]);
  const rowStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["rgba(139,90,43,0)", colors.brown || BROWN],
    ),
  }));
  const labelWrapStyle = useAnimatedStyle(() => ({
    width: interpolate(
      progress.value,
      [0, 1],
      [0, compact ? 0 : LABEL_MAX_WIDTH],
      Extrapolation.CLAMP,
    ),
  }));
  const labelTextStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.value,
      [0, 0.5, 1],
      [0, 0.6, 1],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [rtl ? 6 : -6, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));
  const Icon = tab.Icon;
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={6}
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label || tab.label}
      testID={`tab-${tab.id}`}
    >
      <Animated.View
        style={[
          styles.tabRow,
          compact && styles.compactTab,
          // RTL: the icon sits on the right and the label opens to its left.
          rtl && !compact && styles.tabRowRtl,
          rowStyle,
        ]}
      >
        <View style={styles.iconWrap}>
          <Icon
            size={21}
            color={active ? "#FFFFFF" : colors.muted}
            strokeWidth={active ? 2.25 : 1.9}
          />
        </View>
        {!compact && (
          <Animated.View style={[styles.labelWrap, labelWrapStyle]}>
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.label,
                rtl && styles.labelRtl,
                { fontFamily: uiFont(active ? 700 : 500) },
                labelTextStyle,
              ]}
            >
              {label || tab.label}
            </Animated.Text>
          </Animated.View>
        )}
      </Animated.View>
    </PressableScale>
  );
}

export default function Dock({
  activeTab,
  onTabPress,
  colors,
  vertical = false,
  rtl = false,
  safeBottom = 0,
  labels = {},
}) {
  const tabs = vertical ? VERTICAL_TABS : TABS;
  return (
    <View
      style={[
        styles.dock,
        vertical ? styles.verticalDock : styles.horizontalDock,
        {
          backgroundColor: colors.cream,
          borderColor: colors.dockBorder,
          shadowColor: colors.brown || BROWN,
        },
        vertical
          ? { top: 14, bottom: 14, ...(rtl ? { left: undefined, right: 14 } : null) }
          : { marginBottom: Math.max(safeBottom, 8) + 8 },
        rtl && !vertical && styles.rtlDock,
      ]}
    >
      {tabs.map((tab) => (
        <AnimatedTab
          key={tab.id}
          tab={tab}
          active={activeTab === tab.id}
          onPress={() => onTabPress(tab.id)}
          colors={colors}
          compact={vertical}
          label={labels[tab.key]}
          rtl={rtl}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    zIndex: 40,
    alignItems: "center",
    borderWidth: 1.5,
    padding: 6,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  horizontalDock: {
    bottom: 0,
    alignSelf: "center",
    flexDirection: "row",
    borderRadius: 28,
  },
  verticalDock: {
    left: 14,
    width: 60,
    borderRadius: 24,
    flexDirection: "column",
    justifyContent: "space-between",
  },
  rtlDock: { flexDirection: "row-reverse" },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    overflow: "hidden",
    marginHorizontal: 2,
  },
  tabRowRtl: { flexDirection: "row-reverse" },
  compactTab: { width: ICON_SIZE, marginHorizontal: 0 },
  iconWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  labelWrap: {
    height: ICON_SIZE,
    justifyContent: "center",
    overflow: "hidden",
  },
  label: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    paddingRight: 16,
    paddingLeft: 1,
  },
  labelRtl: { paddingRight: 6, paddingLeft: 14, textAlign: "center" },
});
