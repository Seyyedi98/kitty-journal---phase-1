import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { useFonts } from "expo-font";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import {
  Vazirmatn_400Regular,
  Vazirmatn_500Medium,
  Vazirmatn_600SemiBold,
  Vazirmatn_700Bold,
} from "@expo-google-fonts/vazirmatn";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  Heart,
  Plus,
  Search,
  Star,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  PenLine,
  BookOpen,
  Save,
  ArrowLeft,
  MapPin,
  Settings2,
  Image as ImageIcon,
} from "lucide-react-native";
import { translations } from "./src/i18n";
import {
  dateKey,
  parseDateKey,
  calendarDateKey,
  calendarMonthLength,
  calendarWeekdayLabels,
  formatCalendarMonth,
  formatDateKey,
  getCalendarParts,
  shiftCalendarMonth,
} from "./src/calendar";
import Dock from "./src/components/Dock";
import CatIllustration from "./src/components/CatIllustration";
import * as ScreenOrientation from "expo-screen-orientation";
import { Dimensions } from "react-native";

let ACTIVE_LANGUAGE = "en";
let ACTIVE_FONTS_LOADED = false;
const FONT_FAMILIES = {
  en: {
    400: "DMSans_400Regular",
    500: "DMSans_500Medium",
    600: "DMSans_600SemiBold",
    700: "DMSans_700Bold",
    800: "DMSans_700Bold",
  },
  tr: {
    400: "DMSans_400Regular",
    500: "DMSans_500Medium",
    600: "DMSans_600SemiBold",
    700: "DMSans_700Bold",
    800: "DMSans_700Bold",
  },
  fa: {
    400: "Vazirmatn_400Regular",
    500: "Vazirmatn_500Medium",
    600: "Vazirmatn_600SemiBold",
    700: "Vazirmatn_700Bold",
    800: "Vazirmatn_700Bold",
  },
};

// Lock screen rotate
// useEffect(() => {
//   ScreenOrientation.lockAsync(
//     ScreenOrientation.OrientationLock.PORTRAIT_UP,
//   ).catch(console.error);
// }, []);

// useEffect(() => {
//   const { width, height } = Dimensions.get("screen");
//   if (!isTablet) {
//     ScreenOrientation.lockAsync(
//       ScreenOrientation.OrientationLock.PORTRAIT_UP,
//     ).catch(console.error);
//   } else {
//     ScreenOrientation.unlockAsync().catch(console.error);
//   }
// }, []);

function Text({ style, ...props }) {
  const flattened = StyleSheet.flatten(style) || {};
  const weight = String(flattened.fontWeight || "400");
  const fontFamily =
    flattened.fontFamily ||
    (ACTIVE_FONTS_LOADED
      ? (FONT_FAMILIES[ACTIVE_LANGUAGE] || FONT_FAMILIES.en)[weight] ||
        (FONT_FAMILIES[ACTIVE_LANGUAGE] || FONT_FAMILIES.en)["400"]
      : undefined);
  return (
    <NativeText
      {...props}
      style={[fontFamily ? { fontFamily } : null, style]}
    />
  );
}
function TextInput(props) {
  const flattened = StyleSheet.flatten(props.style) || {};
  const fontFamily =
    flattened.fontFamily ||
    (ACTIVE_FONTS_LOADED
      ? (FONT_FAMILIES[ACTIVE_LANGUAGE] || FONT_FAMILIES.en)["400"]
      : undefined);
  return (
    <NativeTextInput
      {...props}
      style={[fontFamily ? { fontFamily } : null, props.style]}
    />
  );
}

const MOODS = [
  { key: "veryLow", face: "😿", color: "#E9D5D1" },
  { key: "low", face: "🙁", color: "#F1E0CF" },
  { key: "okay", face: "😐", color: "#F4EBCF" },
  { key: "good", face: "🙂", color: "#DCE9D8" },
  { key: "great", face: "😸", color: "#D5E8D9" },
];
const BASE = {
  ink: "#38352F",
  muted: "#898276",
  paper: "#FBF8F0",
  card: "#FFFDF8",
  line: "#EAE3D5",
  sage: "#DCE6D7",
  sageDark: "#6F8668",
  rose: "#EAD0C6",
  lavender: "#E8E0ED",
  bg: "#F5F0E7",
  cream: "#FBF8F0",
  dockBorder: "#E8DFD1",
  brown: "#8B5A2B",
  accent: "#778B6D",
  accentSoft: "#F1F3EB",
  write: "#F8EEE5",
  white: "#FFFFFF",
};
const DARK = {
  ink: "#EEE8DC",
  muted: "#B5AA98",
  paper: "#242722",
  card: "#2D3029",
  line: "#45473D",
  sage: "#394236",
  sageDark: "#B4C5A6",
  rose: "#514239",
  lavender: "#48404C",
  bg: "#1C1F1A",
  cream: "#282B25",
  dockBorder: "#41443B",
  brown: "#9E7951",
  accent: "#B4C5A6",
  accentSoft: "#2C332A",
  write: "#382F2A",
  white: "#FFFFFF",
};

async function initDb(db) {
  await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
      journal_date TEXT NOT NULL, mood TEXT, favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(journal_date);
    CREATE TABLE IF NOT EXISTS daily_moods (
      journal_date TEXT PRIMARY KEY NOT NULL,
      mood TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function AppShell() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    Vazirmatn_400Regular,
    Vazirmatn_500Medium,
    Vazirmatn_600SemiBold,
    Vazirmatn_700Bold,
  });
  ACTIVE_FONTS_LOADED = fontsLoaded;
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const systemScheme = useColorScheme();
  const [entries, setEntries] = useState([]);
  const [dailyMoods, setDailyMoods] = useState({});
  const [tab, setTab] = useState("home");
  const [language, setLanguage] = useState("en");
  const [calendarType, setCalendarType] = useState("default");
  const [appearance, setAppearance] = useState("system");
  const [search, setSearch] = useState("");
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [entryMood, setEntryMood] = useState(null);
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [calendarMonth, setCalendarMonth] = useState(() =>
    getCalendarParts(dateKey(), "gregorian"),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  ACTIVE_LANGUAGE = language;
  const t = translations[language] || translations.en;
  const rtl = language === "fa";
  const effectiveCalendar =
    calendarType === "default"
      ? language === "fa"
        ? "solarHijri"
        : "gregorian"
      : calendarType;
  const dark =
    appearance === "dark" ||
    (appearance === "system" && systemScheme === "dark");
  const c = dark ? DARK : BASE;
  const today = dateKey();
  const isTablet = width >= 760 && Math.min(width, height) >= 600;
  const isLandscapeTablet = isTablet && width > height;
  const contentWidth = Math.min(width - (isTablet ? 88 : 0), 1060);

  const refresh = useCallback(async () => {
    const rows = await db.getAllAsync(
      "SELECT * FROM entries ORDER BY journal_date DESC, updated_at DESC",
    );
    const moodRows = await db.getAllAsync(
      "SELECT journal_date, mood FROM daily_moods",
    );
    setEntries(rows);
    setDailyMoods(
      Object.fromEntries(moodRows.map((row) => [row.journal_date, row.mood])),
    );
    setReady(true);
  }, [db]);
  useEffect(() => {
    refresh().catch((error) => {
      console.error("Database load failed", error);
      setReady(true);
    });
  }, [refresh]);

  const visibleEntries = useMemo(() => {
    const locale =
      language === "tr" ? "tr-TR" : language === "fa" ? "fa-IR" : "en-US";
    const q = search.trim().toLocaleLowerCase(locale).normalize("NFC");
    if (!q) return entries;
    return entries.filter((entry) =>
      `${entry.title || ""} ${entry.body || ""}`
        .toLocaleLowerCase(locale)
        .normalize("NFC")
        .includes(q),
    );
  }, [entries, search, language]);
  const todayEntries = entries.filter((entry) => entry.journal_date === today);
  const calendarEntries = entries.filter(
    (entry) => entry.journal_date === selectedDate,
  );

  const setDailyMood = async (mood) => {
    const nextMood = dailyMoods[today] === mood ? null : mood;
    try {
      if (nextMood)
        await db.runAsync(
          "INSERT INTO daily_moods (journal_date,mood,updated_at) VALUES (?,?,?) ON CONFLICT(journal_date) DO UPDATE SET mood=excluded.mood, updated_at=excluded.updated_at",
          today,
          nextMood,
          new Date().toISOString(),
        );
      else
        await db.runAsync(
          "DELETE FROM daily_moods WHERE journal_date=?",
          today,
        );
      setDailyMoods((previous) => {
        const next = { ...previous };
        if (nextMood) next[today] = nextMood;
        else delete next[today];
        return next;
      });
    } catch (error) {
      Alert.alert("Could not save mood", "Please try again.");
      console.error(error);
    }
  };

  const openNew = (date = today) => {
    setEditing(null);
    setTitle("");
    setBody("");
    setEntryMood(null);
    setSelectedDate(date);
    setEditorVisible(true);
    setSaveStatus("");
  };
  const openEdit = (entry) => {
    setEditing(entry);
    setTitle(entry.title || "");
    setBody(entry.body || "");
    setEntryMood(entry.mood || null);
    setSelectedDate(entry.journal_date);
    setEditorVisible(true);
    setSaveStatus("");
  };
  const saveEntry = async () => {
    if (!body.trim() && !title.trim()) {
      Alert.alert(t.newEntry, t.body);
      return;
    }
    const now = new Date().toISOString();
    try {
      setSaveStatus("Saving…");
      if (editing)
        await db.runAsync(
          "UPDATE entries SET title=?, body=?, journal_date=?, mood=?, updated_at=? WHERE id=?",
          title.trim(),
          body.trim(),
          selectedDate,
          entryMood,
          now,
          editing.id,
        );
      else
        await db.runAsync(
          "INSERT INTO entries (title,body,journal_date,mood,favorite,created_at,updated_at) VALUES (?,?,?,?,0,?,?)",
          title.trim(),
          body.trim(),
          selectedDate,
          entryMood,
          now,
          now,
        );
      await refresh();
      setEditorVisible(false);
      setSaveStatus(t.saved);
    } catch (error) {
      setSaveStatus("");
      Alert.alert(
        "Save failed",
        "Your entry could not be saved. Please try again.",
      );
      console.error(error);
    }
  };
  const toggleFavorite = async (entry) => {
    await db.runAsync(
      "UPDATE entries SET favorite=?, updated_at=? WHERE id=?",
      entry.favorite ? 0 : 1,
      new Date().toISOString(),
      entry.id,
    );
    await refresh();
  };
  const deleteEntry = (entry) =>
    Alert.alert(t.delete, t.deleteConfirm, [
      { text: t.cancel, style: "cancel" },
      {
        text: t.delete,
        style: "destructive",
        onPress: async () => {
          await db.runAsync("DELETE FROM entries WHERE id=?", entry.id);
          setEditorVisible(false);
          await refresh();
        },
      },
    ]);
  const changeLanguage = (value) => {
    setLanguage(value);
    if (calendarType === "default")
      setCalendarMonth(
        getCalendarParts(
          selectedDate,
          value === "fa" ? "solarHijri" : "gregorian",
        ),
      );
  };
  const changeCalendar = (value) => {
    setCalendarType(value);
    const nextCalendar =
      value === "default"
        ? language === "fa"
          ? "solarHijri"
          : "gregorian"
        : value;
    setCalendarMonth(getCalendarParts(selectedDate, nextCalendar));
  };
  const openTab = (value) => {
    if (value === "settings") {
      setSettingsOpen(true);
      return;
    }
    setTab(value);
    setSettingsOpen(false);
  };
  const dateLabel = (key) =>
    formatDateKey(key, language, effectiveCalendar, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  const calendarData = useMemo(() => {
    const monthLength = calendarMonthLength(
      calendarMonth.year,
      calendarMonth.month,
      effectiveCalendar,
    );
    const firstKey = calendarDateKey(
      calendarMonth.year,
      calendarMonth.month,
      1,
      effectiveCalendar,
    );
    const first = parseDateKey(firstKey);
    const weekStart = language === "fa" ? 6 : language === "tr" ? 1 : 0;
    const offset = (first.getDay() - weekStart + 7) % 7;
    const cells = [
      ...Array(offset).fill(null),
      ...Array.from({ length: monthLength }, (_, index) => index + 1),
    ];
    while (cells.length % 7) cells.push(null);
    return {
      cells,
      weekdays: calendarWeekdayLabels(language),
      monthLabel: formatCalendarMonth(
        calendarMonth.year,
        calendarMonth.month,
        language,
        effectiveCalendar,
      ),
    };
  }, [calendarMonth, effectiveCalendar, language]);

  const pagePadding = isTablet ? 30 : 19;
  const appStyles = [
    styles.mainPanel,
    {
      backgroundColor: c.paper,
      borderColor: c.line,
      width: isTablet ? Math.min(width - 64, 1240) : "100%",
      minHeight: "100%",
    },
    isTablet && styles.tabletPanel,
  ];
  const topBar = (
    <View
      style={[
        styles.topBar,
        { borderBottomColor: c.line },
        rtl && styles.rowReverse,
      ]}
    >
      <View style={[styles.brandIcon, { backgroundColor: c.sage }]}>
        <CatIllustration width={31} height={31} />
      </View>
      <Text style={[styles.brand, { color: c.ink }]}>Kitty Journal</Text>
      <View style={{ flex: 1 }} />
      <Text
        style={[
          styles.datePill,
          { color: c.muted, backgroundColor: dark ? "#36382F" : "#F1ECDF" },
        ]}
      >
        {formatDateKey(today, language, effectiveCalendar, {
          month: "short",
          day: "numeric",
        })}
      </Text>
      <Pressable
        onPress={() => setSettingsOpen((v) => !v)}
        style={styles.topIcon}
        accessibilityLabel={t.settings}
      >
        <Settings2 size={21} color={c.muted} />
      </Pressable>
    </View>
  );

  let content;
  if (!ready)
    content = (
      <View style={styles.loading}>
        <Text style={{ color: c.muted }}>Preparing your journal…</Text>
      </View>
    );
  else if (settingsOpen)
    content = (
      <SettingsScreen
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        changeLanguage={changeLanguage}
        calendar={effectiveCalendar}
        calendarType={calendarType}
        changeCalendar={changeCalendar}
        appearance={appearance}
        setAppearance={setAppearance}
      />
    );
  else if (tab === "home")
    content = (
      <HomeScreen
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        calendar={effectiveCalendar}
        today={today}
        dailyMood={dailyMoods[today]}
        onMood={setDailyMood}
        onNew={() => openNew()}
        search={search}
        setSearch={setSearch}
        entries={visibleEntries}
        isSearching={Boolean(search.trim())}
        onEdit={openEdit}
        onFavorite={toggleFavorite}
        isTablet={isTablet}
      />
    );
  else if (tab === "calendar")
    content = (
      <CalendarScreen
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        calendar={effectiveCalendar}
        calendarData={calendarData}
        calendarMonth={calendarMonth}
        setCalendarMonth={setCalendarMonth}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        today={today}
        entries={entries}
        selectedEntries={calendarEntries}
        onNew={() => openNew(selectedDate)}
        onEdit={openEdit}
        onFavorite={toggleFavorite}
      />
    );
  else if (tab === "memories")
    content = (
      <MemoriesScreen
        t={t}
        c={c}
        rtl={rtl}
        entries={entries}
        onEdit={openEdit}
      />
    );
  else
    content = (
      <InsightsScreen
        t={t}
        c={c}
        rtl={rtl}
        entries={entries}
        dailyMoods={dailyMoods}
      />
    );

  return (
    <View
      style={[
        styles.safeRoot,
        { backgroundColor: c.bg, paddingTop: insets.top },
      ]}
    >
      <ExpoStatusBar
        style={dark ? "light" : "dark"}
        backgroundColor={c.bg}
        translucent={false}
      />
      <View
        style={[
          styles.appFrame,
          isTablet && styles.tabletFrame,
          { backgroundColor: c.bg, paddingBottom: isTablet ? 24 : 0 },
        ]}
      >
        <View style={appStyles}>
          {topBar}
          <View
            style={[
              styles.bodyRow,
              isLandscapeTablet && styles.landscapeBody,
              rtl && isLandscapeTablet && styles.rowReverse,
            ]}
          >
            {isLandscapeTablet && <View style={{ width: 72 }} />}
            <View
              style={[
                styles.contentArea,
                {
                  paddingHorizontal: pagePadding,
                  maxWidth: contentWidth,
                  paddingBottom: (isLandscapeTablet ? 24 : 96) + insets.bottom,
                },
              ]}
            >
              {content}
            </View>
          </View>
          {!editorVisible && !isLandscapeTablet && (
            <Dock
              activeTab={settingsOpen ? "" : tab}
              onTabPress={openTab}
              colors={c}
              rtl={rtl}
              safeBottom={insets.bottom}
              labels={{
                home: t.home,
                calendar: t.calendar,
                memories: t.memories,
                insights: t.insights,
                settings: t.settings,
              }}
            />
          )}
          {isLandscapeTablet && (
            <Dock
              activeTab={settingsOpen ? "settings" : tab}
              onTabPress={openTab}
              colors={c}
              vertical
              safeBottom={insets.bottom}
              rtl={rtl}
              labels={{
                home: t.home,
                calendar: t.calendar,
                memories: t.memories,
                insights: t.insights,
                settings: t.settings,
              }}
            />
          )}
          {!settingsOpen && (
            <Pressable
              onPress={() => openNew(tab === "calendar" ? selectedDate : today)}
              style={[
                styles.floatingAdd,
                {
                  backgroundColor: c.accent,
                  bottom: (isLandscapeTablet ? 25 : 92) + insets.bottom,
                  right: rtl ? undefined : isTablet ? 34 : 20,
                  left: rtl ? (isTablet ? 34 : 20) : undefined,
                },
              ]}
              accessibilityLabel={t.newEntry}
            >
              <Plus size={23} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      </View>
      <EditorModal
        visible={editorVisible}
        onClose={() => setEditorVisible(false)}
        editing={editing}
        title={title}
        setTitle={setTitle}
        body={body}
        setBody={setBody}
        mood={entryMood}
        setMood={setEntryMood}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        save={saveEntry}
        deleteEntry={deleteEntry}
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        calendar={effectiveCalendar}
        status={saveStatus}
        insets={insets}
      />
    </View>
  );
}

function HomeScreen({
  t,
  c,
  rtl,
  language,
  calendar,
  today,
  dailyMood,
  onMood,
  onNew,
  search,
  setSearch,
  entries,
  isSearching,
  onEdit,
  onFavorite,
  isTablet,
}) {
  const todayLabel = formatDateKey(today, language, calendar, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const moodOptions = (
    <View style={[styles.moodOptions, rtl && styles.rowReverse]}>
      {MOODS.map((mood) => (
        <Pressable
          key={mood.key}
          onPress={() => onMood(mood.key)}
          style={[
            styles.moodOption,
            {
              backgroundColor:
                dailyMood === mood.key
                  ? c.card
                  : c.paper === BASE.paper
                    ? "#FFFFFF80"
                    : c.card,
              borderColor: dailyMood === mood.key ? c.sageDark : "transparent",
            },
          ]}
        >
          <Text style={styles.moodEmoji}>{mood.face}</Text>
          <Text
            style={[
              styles.moodLabel,
              { color: dailyMood === mood.key ? c.sageDark : c.muted },
            ]}
          >
            {t[mood.key]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      contentContainerStyle={styles.pageContent}
    >
      <View
        style={[
          styles.homeGrid,
          isTablet && styles.tabletHomeGrid,
          rtl && styles.rowReverse,
        ]}
      >
        <View style={styles.homeColumn}>
          <Animated.View
            entering={FadeInDown.duration(380)}
            style={[styles.welcomeRow, rtl && styles.rowReverse]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: c.muted }]}>
                {todayLabel.toLocaleUpperCase(
                  language === "tr"
                    ? "tr-TR"
                    : language === "fa"
                      ? "fa-IR"
                      : "en-US",
                )}{" "}
                <Text style={{ color: "#B5C5AC" }}>·</Text>
              </Text>
              <Text
                style={[
                  styles.heroTitle,
                  { color: c.ink, textAlign: rtl ? "right" : "left" },
                ]}
              >
                {t.greeting}
              </Text>
              <Text
                style={[
                  styles.subheading,
                  { color: c.muted, textAlign: rtl ? "right" : "left" },
                ]}
              >
                {t.subtitle}
              </Text>
            </View>
            <CatIllustration
              width={isTablet ? 142 : 104}
              height={isTablet ? 130 : 98}
            />
          </Animated.View>
          <Animated.View
            entering={FadeInDown.delay(60).duration(380)}
            style={[
              styles.moodCard,
              {
                backgroundColor: darkenOr(c.accentSoft, c.card),
                borderColor: c.line,
              },
            ]}
          >
            <View style={[styles.sectionHeading, rtl && styles.rowReverse]}>
              <View
                style={[styles.sectionHeadingLeft, rtl && styles.rowReverse]}
              >
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: c.sage, color: c.sageDark },
                  ]}
                >
                  <Sparkles size={16} color={c.sageDark} />
                </View>
                <Text style={[styles.sectionTitle, { color: c.ink }]}>
                  {t.todayMood}
                </Text>
              </View>
              <Text style={{ color: c.muted }}>♡</Text>
            </View>
            {moodOptions}
          </Animated.View>
          {!isSearching && (
            <Animated.View
              entering={FadeInDown.delay(120).duration(380)}
              style={[
                styles.writeCard,
                { backgroundColor: c.write, borderColor: c.line },
                rtl && styles.rowReverse,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.writeKicker, { color: c.muted }]}>
                  {language === "fa"
                    ? "یک لحظه برای خودت"
                    : language === "tr"
                      ? "Kendine küçük bir an"
                      : "A LITTLE MOMENT FOR YOU"}
                </Text>
                <Text
                  style={[
                    styles.writeTitle,
                    { color: c.ink, textAlign: rtl ? "right" : "left" },
                  ]}
                >
                  {t.write} <Text style={{ color: "#B89C85" }}>✧</Text>
                </Text>
                <Text
                  style={[
                    styles.writeHint,
                    { color: c.muted, textAlign: rtl ? "right" : "left" },
                  ]}
                >
                  {t.prompt}
                </Text>
              </View>
              <Pressable
                onPress={onNew}
                style={[styles.primaryButton, { backgroundColor: c.accent }]}
              >
                <PenLine size={16} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>{t.newEntry}</Text>
              </Pressable>
              <Text style={styles.flowerA}>✿</Text>
              <Text style={styles.flowerB}>✧</Text>
            </Animated.View>
          )}
        </View>
        <View style={styles.homeColumn}>
          <View style={[styles.recentHeading, rtl && styles.rowReverse]}>
            <View>
              <Text style={[styles.eyebrow, { color: c.muted }]}>
                {isSearching ? t.search : t.recent}
              </Text>
              <Text style={[styles.recentTitle, { color: c.ink }]}>
                {isSearching ? t.search : t.recent}
              </Text>
            </View>
            <Text
              style={[
                styles.countPill,
                { color: c.muted, backgroundColor: c.accentSoft },
              ]}
            >
              {entries.length}
            </Text>
          </View>
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: darkenOr(c.accentSoft, c.card),
                borderColor: c.line,
              },
              rtl && styles.rowReverse,
            ]}
          >
            <Search size={17} color={c.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t.search}
              placeholderTextColor={c.muted}
              style={[
                styles.searchInput,
                { color: c.ink, textAlign: rtl ? "right" : "left" },
              ]}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              underlineColorAndroid="transparent"
              blurOnSubmit={false}
            />
          </View>
          {entries.length ? (
            <EntryList
              entries={entries.slice(0, isSearching ? 50 : 6)}
              t={t}
              c={c}
              language={language}
              calendar={calendar}
              rtl={rtl}
              onEdit={onEdit}
              onFavorite={onFavorite}
            />
          ) : (
            <EmptyState
              c={c}
              title={isSearching ? t.noResults : t.noEntries}
              hint={isSearching ? t.noResultsHint : t.noEntriesHint}
              icon={isSearching ? Search : BookOpen}
            />
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function CalendarScreen({
  t,
  c,
  rtl,
  language,
  calendar,
  calendarData,
  calendarMonth,
  setCalendarMonth,
  selectedDate,
  setSelectedDate,
  today,
  entries,
  selectedEntries,
  onNew,
  onEdit,
  onFavorite,
}) {
  const entryDates = useMemo(
    () => new Set(entries.map((entry) => entry.journal_date)),
    [entries],
  );
  const previous = () =>
    setCalendarMonth((current) =>
      shiftCalendarMonth(current.year, current.month, -1),
    );
  const next = () =>
    setCalendarMonth((current) =>
      shiftCalendarMonth(current.year, current.month, 1),
    );
  const localeTag =
    language === "fa" ? "fa-IR" : language === "tr" ? "tr-TR" : "en-US";
  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <Text style={[styles.eyebrow, { color: c.muted }]}>{t.calendar}</Text>
      <Text style={[styles.pageTitle, { color: c.ink }]}>{t.calendar}</Text>
      <View
        style={[
          styles.calendarCard,
          { backgroundColor: c.card, borderColor: c.line },
        ]}
      >
        <View style={styles.calendarHeader}>
          <Pressable
            onPress={previous}
            style={[
              styles.calendarArrow,
              { backgroundColor: c.paper, borderColor: c.line },
            ]}
          >
            <ChevronLeft size={18} color={c.ink} />
          </Pressable>
          <Text style={[styles.calendarMonth, { color: c.ink }]}>
            {calendarData.monthLabel}
          </Text>
          <Pressable
            onPress={next}
            style={[
              styles.calendarArrow,
              { backgroundColor: c.paper, borderColor: c.line },
            ]}
          >
            <ChevronRight size={18} color={c.ink} />
          </Pressable>
        </View>
        <View style={[styles.weekdayRow, rtl && styles.rowReverse]}>
          {calendarData.weekdays.map((day, index) => (
            <View key={`${day}-${index}`} style={styles.weekdayCell}>
              <Text style={[styles.weekdayText, { color: c.muted }]}>
                {day}
              </Text>
            </View>
          ))}
        </View>
        <View style={[styles.calendarDays, rtl && styles.rowReverse]}>
          {calendarData.cells.map((day, index) => {
            if (day === null)
              return (
                <View key={`blank-${index}`} style={styles.calendarDayCell} />
              );
            const key = calendarDateKey(
              calendarMonth.year,
              calendarMonth.month,
              day,
              calendar,
            );
            const selected = selectedDate === key;
            const isToday = today === key;
            const hasEntry = entryDates.has(key);
            const dayText = new Intl.NumberFormat(localeTag, {
              useGrouping: false,
            }).format(day);
            return (
              <Pressable
                key={key}
                onPress={() => setSelectedDate(key)}
                style={[
                  styles.calendarDayCell,
                  selected && {
                    backgroundColor: c.sage,
                    borderColor: c.sageDark,
                  },
                  isToday && !selected && { borderColor: c.rose },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={formatDateKey(key, language, calendar, {
                  dateStyle: "full",
                })}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    { color: selected ? c.sageDark : c.ink },
                  ]}
                >
                  {dayText}
                </Text>
                {hasEntry ? (
                  <View
                    style={[styles.dayDot, { backgroundColor: c.accent }]}
                  />
                ) : (
                  <View style={styles.dayDotPlaceholder} />
                )}
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.calendarNote, { color: c.muted }]}>
          {t.selectedDate ||
            (language === "fa"
              ? "تاریخ انتخاب‌شده"
              : language === "tr"
                ? "Seçilen tarih"
                : "Selected date")}
          :{" "}
          {formatDateKey(selectedDate, language, calendar, {
            dateStyle: "long",
          })}
        </Text>
      </View>
      <View style={[styles.recentHeading, rtl && styles.rowReverse]}>
        <View>
          <Text style={[styles.eyebrow, { color: c.muted }]}>
            {formatDateKey(selectedDate, language, calendar, {
              dateStyle: "long",
            })}
          </Text>
          <Text style={[styles.recentTitle, { color: c.ink }]}>
            {t.entriesForDate || t.recent}
          </Text>
        </View>
        <Pressable
          onPress={onNew}
          style={[styles.smallAddButton, { backgroundColor: c.accent }]}
        >
          <Plus size={16} color="#FFFFFF" />
        </Pressable>
      </View>
      {selectedEntries.length ? (
        <EntryList
          entries={selectedEntries}
          t={t}
          c={c}
          language={language}
          calendar={calendar}
          rtl={rtl}
          onEdit={onEdit}
          onFavorite={onFavorite}
        />
      ) : (
        <EmptyState
          c={c}
          title={t.emptyCalendar}
          hint={t.noEntriesHint}
          icon={BookOpen}
        />
      )}
    </ScrollView>
  );
}

function EntryList({
  entries,
  t,
  c,
  language,
  calendar,
  rtl,
  onEdit,
  onFavorite,
}) {
  return (
    <View style={styles.entryList}>
      {entries.map((entry) => (
        <View
          key={entry.id}
          style={[
            styles.entryCard,
            { backgroundColor: c.card, borderColor: c.line },
            rtl && styles.rowReverse,
          ]}
        >
          <Pressable onPress={() => onEdit(entry)} style={{ flex: 1 }}>
            <Text
              style={[
                styles.entryDate,
                { color: c.muted, textAlign: rtl ? "right" : "left" },
              ]}
            >
              {formatDateKey(entry.journal_date, language, calendar, {
                dateStyle: "medium",
              })}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.entryTitle,
                { color: c.ink, textAlign: rtl ? "right" : "left" },
              ]}
            >
              {entry.title || entry.body?.slice(0, 52) || t.noTitle}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.entryBody,
                { color: c.muted, textAlign: rtl ? "right" : "left" },
              ]}
            >
              {entry.body}
            </Text>
          </Pressable>
          {entry.mood ? (
            <Text style={styles.entryMood}>
              {MOODS.find((mood) => mood.key === entry.mood)?.face}
            </Text>
          ) : null}
          <Pressable
            onPress={() => onFavorite(entry)}
            style={styles.entryAction}
            accessibilityLabel={t.favorite}
          >
            <Star
              size={17}
              color={entry.favorite ? "#B78E57" : c.muted}
              fill={entry.favorite ? "#B78E57" : "transparent"}
            />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function EmptyState({ c, title, hint, icon: Icon = BookOpen }) {
  return (
    <View
      style={[
        styles.emptyCard,
        { backgroundColor: c.card, borderColor: c.line },
      ]}
    >
      <View style={[styles.emptyArt, { backgroundColor: c.lavender }]}>
        <BookOpen size={27} color="#A091B0" />
        <View style={styles.emptyCat}>
          <Text style={{ fontSize: 15 }}>☻</Text>
        </View>
        <Text style={styles.emptyStar}>✦</Text>
      </View>
      <Text style={[styles.emptyTitle, { color: c.ink }]}>{title}</Text>
      <Text style={[styles.emptyHint, { color: c.muted }]}>{hint}</Text>
    </View>
  );
}

function MemoriesScreen({ t, c, rtl, entries, onEdit }) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <Text style={[styles.eyebrow, { color: c.muted }]}>{t.memories}</Text>
      <Text style={[styles.pageTitle, { color: c.ink }]}>{t.memories}</Text>
      <View
        style={[
          styles.memoryTabs,
          { backgroundColor: c.card, borderColor: c.line },
        ]}
      >
        <View style={[styles.memoryTabActive, { backgroundColor: c.sage }]}>
          <ImageIcon size={16} color={c.sageDark} />
          <Text style={{ color: c.sageDark, fontWeight: "700", fontSize: 12 }}>
            {t.images || "Images"}
          </Text>
        </View>
        <View style={styles.memoryTab}>
          <MapPin size={16} color={c.muted} />
          <Text style={{ color: c.muted, fontSize: 12 }}>{t.map || "Map"}</Text>
        </View>
      </View>
      <EmptyState c={c} title={t.memorySoon} hint={t.memoryHint} icon={Heart} />
      {entries.length > 0 && (
        <View style={{ marginTop: 18 }}>
          <Text
            style={[styles.recentTitle, { color: c.ink, marginBottom: 12 }]}
          >
            {t.recent}
          </Text>
          <EntryList
            entries={entries.slice(0, 5)}
            t={t}
            c={c}
            language="en"
            calendar="gregorian"
            rtl={rtl}
            onEdit={onEdit}
            onFavorite={() => {}}
          />
        </View>
      )}
    </ScrollView>
  );
}

function InsightsScreen({ t, c, rtl, entries, dailyMoods }) {
  const stats = [
    [entries.length, t.entries, BookOpen],
    [entries.filter((entry) => entry.favorite).length, t.favorites, Star],
    [Object.keys(dailyMoods).length, t.moods, Heart],
  ];
  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <Text style={[styles.eyebrow, { color: c.muted }]}>{t.insights}</Text>
      <Text style={[styles.pageTitle, { color: c.ink }]}>{t.insights}</Text>
      <View style={styles.insightGrid}>
        {stats.map(([number, label, Icon]) => (
          <View
            key={label}
            style={[
              styles.insightCard,
              { backgroundColor: c.card, borderColor: c.line },
            ]}
          >
            <Icon size={19} color={c.sageDark} />
            <Text style={[styles.statNumber, { color: c.sageDark }]}>
              {number}
            </Text>
            <Text style={[styles.statLabel, { color: c.muted }]}>{label}</Text>
          </View>
        ))}
      </View>
      <EmptyState
        c={c}
        title={t.insights}
        hint={t.insightsHint}
        icon={Sparkles}
      />
    </ScrollView>
  );
}

function SettingsScreen({
  t,
  c,
  rtl,
  language,
  changeLanguage,
  calendar,
  calendarType,
  changeCalendar,
  appearance,
  setAppearance,
}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <Text style={[styles.eyebrow, { color: c.muted }]}>{t.settings}</Text>
      <Text style={[styles.pageTitle, { color: c.ink }]}>{t.settings}</Text>
      <SettingGroup title={t.language} c={c} rtl={rtl}>
        {[
          ["en", "English"],
          ["fa", "فارسی"],
          ["tr", "Türkçe"],
        ].map(([value, label]) => (
          <Choice
            key={value}
            label={label}
            selected={language === value}
            onPress={() => changeLanguage(value)}
            c={c}
          />
        ))}
      </SettingGroup>
      <SettingGroup title={t.calendarType} c={c} rtl={rtl}>
        <Choice
          label={t.solarHijri}
          selected={calendar === "solarHijri"}
          onPress={() => changeCalendar("solarHijri")}
          c={c}
        />
        <Choice
          label={t.gregorian}
          selected={calendar === "gregorian"}
          onPress={() => changeCalendar("gregorian")}
          c={c}
        />
        <Choice
          label={
            language === "fa"
              ? "پیش‌فرض زبان"
              : language === "tr"
                ? "Dil varsayılanı"
                : "Language default"
          }
          selected={calendarType === "default"}
          onPress={() => changeCalendar("default")}
          c={c}
        />
      </SettingGroup>
      <SettingGroup title={t.appearance} c={c} rtl={rtl}>
        <Choice
          label={t.light}
          selected={appearance === "light"}
          onPress={() => setAppearance("light")}
          c={c}
        />
        <Choice
          label={t.dark}
          selected={appearance === "dark"}
          onPress={() => setAppearance("dark")}
          c={c}
        />
        <Choice
          label={t.system}
          selected={appearance === "system"}
          onPress={() => setAppearance("system")}
          c={c}
        />
      </SettingGroup>
      <View
        style={[
          styles.privacyCard,
          { backgroundColor: c.card, borderColor: c.line },
        ]}
      >
        <Heart size={20} color={c.sageDark} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.settingTitle, { color: c.ink }]}>
            {language === "fa"
              ? "یادداشت‌ها روی دستگاه تو می‌مانند"
              : language === "tr"
                ? "Kayıtların cihazında kalır"
                : "Your journal stays on this device"}
          </Text>
          <Text style={[styles.settingNote, { color: c.muted }]}>
            {language === "fa"
              ? "ذخیره‌سازی محلی فعال است؛ همگام‌سازی ابری هنوز پیاده‌سازی نشده است."
              : language === "tr"
                ? "Yerel kayıt etkin; bulut eşitlemesi henüz eklenmedi."
                : "Local storage is active. Cloud sync has not been implemented yet."}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function SettingGroup({ title, children, c, rtl }) {
  return (
    <View
      style={[
        styles.settingGroup,
        { backgroundColor: c.card, borderColor: c.line },
      ]}
    >
      <Text
        style={[
          styles.settingTitle,
          { color: c.ink, textAlign: rtl ? "right" : "left" },
        ]}
      >
        {title}
      </Text>
      <View style={[styles.choiceRow, rtl && styles.rowReverse]}>
        {children}
      </View>
    </View>
  );
}
function Choice({ label, selected, onPress, c }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? c.accentSoft : c.paper,
          borderColor: selected ? c.sageDark : c.line,
        },
      ]}
    >
      <Text
        style={[styles.choiceText, { color: selected ? c.sageDark : c.ink }]}
      >
        {label}
      </Text>
      {selected ? <Text style={{ color: c.sageDark }}>✓</Text> : null}
    </Pressable>
  );
}

function EditorModal({
  visible,
  onClose,
  editing,
  title,
  setTitle,
  body,
  setBody,
  mood,
  setMood,
  selectedDate,
  setSelectedDate,
  save,
  deleteEntry,
  t,
  c,
  rtl,
  language,
  calendar,
  status,
  insets,
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.modalRoot,
          { backgroundColor: c.paper, paddingTop: insets.top },
        ]}
      >
        <ExpoStatusBar
          style={c === DARK ? "light" : "dark"}
          backgroundColor={c.paper}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={[
              styles.modalHeader,
              { borderBottomColor: c.line },
              rtl && styles.rowReverse,
            ]}
          >
            <Pressable onPress={onClose} style={styles.modalHeaderButton}>
              <ArrowLeft size={18} color={c.muted} />
              <Text style={{ color: c.muted }}>{t.cancel}</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: c.ink }]}>
              {editing ? t.edit : t.newEntry}
            </Text>
            <Pressable onPress={save} style={styles.modalHeaderButton}>
              <Save size={17} color={c.sageDark} />
              <Text style={{ color: c.sageDark, fontWeight: "700" }}>
                {t.save}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.editorContent}
          >
            <Text
              style={[
                styles.entryDate,
                { color: c.muted, textAlign: rtl ? "right" : "left" },
              ]}
            >
              {formatDateKey(selectedDate, language, calendar, {
                dateStyle: "full",
              })}
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t.title}
              placeholderTextColor={c.muted}
              style={[
                styles.titleInput,
                {
                  color: c.ink,
                  borderBottomColor: c.line,
                  textAlign: rtl ? "right" : "left",
                },
              ]}
            />
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={t.body}
              placeholderTextColor={c.muted}
              multiline
              textAlignVertical="top"
              style={[
                styles.bodyInput,
                { color: c.ink, textAlign: rtl ? "right" : "left" },
              ]}
            />
            <Text
              style={[styles.sectionTitle, { color: c.ink, marginTop: 10 }]}
            >
              {t.chooseMood}
            </Text>
            <View style={[styles.moodOptions, rtl && styles.rowReverse]}>
              {MOODS.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => setMood(mood === item.key ? null : item.key)}
                  style={[
                    styles.moodOption,
                    {
                      backgroundColor: mood === item.key ? item.color : c.card,
                      borderColor: mood === item.key ? c.sageDark : c.line,
                    },
                  ]}
                >
                  <Text style={styles.moodEmoji}>{item.face}</Text>
                  <Text style={[styles.moodLabel, { color: c.muted }]}>
                    {t[item.key]}
                  </Text>
                </Pressable>
              ))}
            </View>
            {status ? (
              <Text style={[styles.saveStatus, { color: c.sageDark }]}>
                {status}
              </Text>
            ) : null}
            {editing ? (
              <Pressable
                onPress={() => deleteEntry(editing)}
                style={styles.deleteButton}
              >
                <Trash2 size={17} color="#B64E45" />
                <Text style={{ color: "#B64E45", fontWeight: "600" }}>
                  {t.delete}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function darkenOr(lightColor, darkColor) {
  return lightColor === BASE.accentSoft ? "#F1F3EB" : darkColor;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="kitty-journal.db" onInit={initDb}>
        <AppShell />
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeRoot: { flex: 1 },
  appFrame: { flex: 1, alignItems: "center" },
  tabletFrame: { paddingHorizontal: 22, paddingTop: 18 },
  mainPanel: {
    flex: 1,
    overflow: "hidden",
    borderWidth: 0,
    borderRadius: 0,
    paddingBottom: 0,
  },
  tabletPanel: {
    borderWidth: 1,
    borderRadius: 30,
    shadowColor: "#4C3C25",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.1,
    shadowRadius: 34,
    elevation: 3,
  },
  topBar: {
    height: 66,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandIcon: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 17, fontWeight: "700", letterSpacing: -0.4 },
  datePill: {
    fontSize: 10,
    letterSpacing: 0.3,
    borderRadius: 99,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  topIcon: {
    width: 37,
    height: 37,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  bodyRow: { flex: 1, flexDirection: "row", justifyContent: "center" },
  landscapeBody: { justifyContent: "flex-start" },
  contentArea: { width: "100%", flex: 1, alignSelf: "center" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  pageContent: { paddingTop: 25, paddingBottom: 22, gap: 14 },
  homeGrid: { gap: 0 },
  tabletHomeGrid: { flexDirection: "row", alignItems: "flex-start", gap: 24 },
  homeColumn: { flex: 1, minWidth: 0 },
  welcomeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 106,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.6,
    fontWeight: "700",
    marginBottom: 9,
  },
  heroTitle: {
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 29,
    lineHeight: 36,
    fontWeight: "500",
    letterSpacing: -0.7,
    maxWidth: 380,
  },
  subheading: { fontSize: 12, marginTop: 10, lineHeight: 18 },
  moodCard: {
    marginTop: 22,
    borderWidth: 1,
    borderRadius: 19,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionHeadingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flex: 1,
  },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { fontSize: 13, fontWeight: "700" },
  moodOptions: { flexDirection: "row", gap: 7, marginTop: 16 },
  rowReverse: { flexDirection: "row-reverse" },
  moodOption: {
    flex: 1,
    minWidth: 0,
    minHeight: 69,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 2,
    gap: 6,
  },
  moodEmoji: { fontSize: 20 },
  moodLabel: { fontSize: 9, fontWeight: "600", textAlign: "center" },
  writeCard: {
    position: "relative",
    overflow: "hidden",
    marginTop: 16,
    minHeight: 128,
    borderWidth: 1,
    borderRadius: 19,
    paddingVertical: 19,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  writeKicker: { fontSize: 9, letterSpacing: 0.8, marginBottom: 6 },
  writeTitle: {
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 23,
    fontWeight: "500",
  },
  writeHint: { fontSize: 11, lineHeight: 17, marginTop: 7 },
  primaryButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    elevation: 2,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  flowerA: {
    position: "absolute",
    right: 14,
    top: -18,
    fontSize: 39,
    color: "#E7D3C4",
  },
  flowerB: {
    position: "absolute",
    right: 90,
    bottom: -20,
    fontSize: 30,
    color: "#E7D3C4",
  },
  recentHeading: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 27,
    marginBottom: 12,
    gap: 10,
  },
  recentTitle: {
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 23,
    fontWeight: "500",
  },
  countPill: {
    overflow: "hidden",
    borderRadius: 99,
    paddingVertical: 5,
    paddingHorizontal: 9,
    fontSize: 10,
  },
  searchBox: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 11,
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 9, fontSize: 12 },
  entryList: { gap: 9 },
  entryCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  entryDate: { fontSize: 9, letterSpacing: 0.25, marginBottom: 5 },
  entryTitle: {
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 15,
    fontWeight: "500",
  },
  entryBody: { fontSize: 10, marginTop: 5 },
  entryMood: { fontSize: 17 },
  entryAction: {
    width: 31,
    height: 31,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 24,
    alignItems: "center",
    marginTop: 3,
  },
  emptyArt: {
    width: 70,
    height: 57,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    position: "relative",
  },
  emptyCat: {
    position: "absolute",
    right: -5,
    bottom: -3,
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: "#E4C9B3",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStar: {
    position: "absolute",
    left: -5,
    top: -8,
    fontSize: 19,
    color: "#C4AD82",
  },
  emptyTitle: {
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 4,
  },
  emptyHint: {
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 7,
    maxWidth: 300,
  },
  pageTitle: {
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 29,
    fontWeight: "500",
    marginTop: -4,
    marginBottom: 6,
  },
  calendarCard: { borderWidth: 1, borderRadius: 19, padding: 15, marginTop: 8 },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  calendarArrow: {
    width: 35,
    height: 35,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarMonth: { fontSize: 16, fontWeight: "700" },
  weekdayRow: { flexDirection: "row", marginBottom: 7 },
  weekdayCell: { flex: 1, alignItems: "center", paddingVertical: 6 },
  weekdayText: { fontSize: 10, fontWeight: "700" },
  calendarDays: { flexDirection: "row", flexWrap: "wrap" },
  calendarDayCell: {
    width: `${100 / 7}%`,
    minHeight: 43,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  dayNumber: { fontSize: 12, fontWeight: "600" },
  dayDot: { width: 4, height: 4, borderRadius: 2, marginTop: 3 },
  dayDotPlaceholder: { height: 7, marginTop: 3 },
  calendarNote: { fontSize: 10, textAlign: "center", marginTop: 10 },
  smallAddButton: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  memoryTabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 13,
    padding: 5,
    marginTop: 8,
  },
  memoryTab: {
    flex: 1,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  memoryTabActive: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  insightGrid: { flexDirection: "row", gap: 9, marginTop: 10 },
  insightCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 11,
    gap: 8,
  },
  statNumber: { fontSize: 25, fontWeight: "500" },
  statLabel: { fontSize: 10 },
  settingGroup: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 16,
    gap: 12,
    marginTop: 13,
  },
  settingTitle: { fontSize: 13, fontWeight: "700" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  choice: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  choiceText: { fontSize: 11, fontWeight: "600" },
  privacyCard: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 14,
  },
  settingNote: { fontSize: 11, lineHeight: 17, marginTop: 5 },
  floatingAdd: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#556B4B",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.26,
    shadowRadius: 14,
    elevation: 9,
    zIndex: 35,
  },
  modalRoot: { flex: 1 },
  modalHeader: {
    minHeight: 58,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalHeaderButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
  },
  modalTitle: { fontSize: 15, fontWeight: "700" },
  editorContent: { padding: 22, gap: 13, flexGrow: 1 },
  titleInput: {
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 27,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  bodyInput: {
    minHeight: 240,
    fontSize: 15,
    lineHeight: 25,
    paddingVertical: 12,
  },
  saveStatus: { fontSize: 11, marginTop: 5 },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    marginTop: 10,
  },
});
