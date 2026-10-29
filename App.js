import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
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
import {
  Animated,
  GrowBar,
  Pop,
  PressableScale,
  fadeIn,
  fadeInDown,
  listLayout,
  slideInUp,
  slideOutDown,
  stagger,
  zoomIn,
} from "./src/motion";
import {
  Heart,
  Plus,
  Search,
  Star,
  Pin,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  PenLine,
  BookOpen,
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
import EditorModal from "./src/components/EditorModal";
import FilterBar, {
  EMPTY_FILTERS,
  applyFilters,
  hasActiveFilters,
} from "./src/components/FilterBar";
import { ScrollView, Text, TextInput, setUiFontsLoaded, setUiLanguage } from "./src/ui";
import { BASE, DARK, MOODS } from "./src/theme";
import { runMigrations } from "./src/db/migrations";
import {
  listEntries,
  listTags,
  listDailyMoods,
  countDeletedEntries,
  setDailyMood as saveDailyMood,
  setFavorite,
  restoreEntry,
  loadSettings,
  saveSetting,
} from "./src/db/repository";
import { matchesQuery } from "./src/utils/text";
import EmptyState from "./src/components/EmptyState";
import MemoriesScreen from "./src/screens/MemoriesScreen";
import TrashScreen from "./src/screens/TrashScreen";
import TagsScreen from "./src/screens/TagsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import BackupScreen from "./src/screens/BackupScreen";
import StorageScreen from "./src/screens/StorageScreen";
import { numberFormatter } from "./src/utils/format";
import { EMOTIONS } from "./src/utils/emotions";

// Lock screen rotate
// useEffect(() => {
//   ScreenOrientation.lockAsync(
//     ScreenOrientation.OrientationLock.PORTRAIT_UP,
//   ).catch(console.error);
// }, []);

const LANGUAGES = ["en", "fa", "tr"];
const CALENDAR_TYPES = ["default", "solarHijri", "gregorian"];
const APPEARANCES = ["light", "dark", "system"];
const UNDO_MS = 7000;

// Keeps "today" correct when the app stays open past midnight.
function useToday() {
  const [today, setToday] = useState(() => dateKey());
  useEffect(() => {
    const check = () => setToday((prev) => (dateKey() === prev ? prev : dateKey()));
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    const id = setInterval(check, 60000);
    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, []);
  return today;
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
  setUiFontsLoaded(fontsLoaded);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const systemScheme = useColorScheme();
  const today = useToday();
  const [entries, setEntries] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [dailyMoods, setDailyMoods] = useState({});
  const [tab, setTab] = useState("home");
  const [language, setLanguage] = useState("en");
  const [calendarType, setCalendarType] = useState("default");
  const [appearance, setAppearance] = useState("system");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editorDate, setEditorDate] = useState(() => dateKey());
  const [selectedDate, setSelectedDate] = useState(() => dateKey());
  const [calendarMonth, setCalendarMonth] = useState(() =>
    getCalendarParts(dateKey(), "gregorian"),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subScreen, setSubScreen] = useState(null); // null | "trash" | "tags" | "backup" | "storage"
  const [trashCount, setTrashCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);
  const shortestSide = Math.min(width, height);

  setUiLanguage(language);
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
  const isTablet = shortestSide >= 600;
  const isLandscapeTablet = isTablet && width > height;
  const contentWidth = Math.min(width - (isTablet ? 88 : 0), 1060);

  const refresh = useCallback(async () => {
    const [rows, tagRows, moods, trashed] = await Promise.all([
      listEntries(db),
      listTags(db),
      listDailyMoods(db),
      countDeletedEntries(db),
    ]);
    setEntries(rows);
    setAllTags(tagRows);
    setDailyMoods(moods);
    setTrashCount(trashed);
    setReady(true);
  }, [db]);

  // First load: migrations already ran in SQLiteProvider.onInit.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadSettings(db);
        if (cancelled) return;
        const lang = LANGUAGES.includes(saved.language) ? saved.language : "en";
        const cal = CALENDAR_TYPES.includes(saved.calendarType)
          ? saved.calendarType
          : "default";
        const look = APPEARANCES.includes(saved.appearance)
          ? saved.appearance
          : "system";
        setLanguage(lang);
        setCalendarType(cal);
        setAppearance(look);
        const effective =
          cal === "default" ? (lang === "fa" ? "solarHijri" : "gregorian") : cal;
        setCalendarMonth(getCalendarParts(dateKey(), effective));
        await refresh();
      } catch (error) {
        console.error("Database load failed", error);
        if (!cancelled) {
          setLoadError(true);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, refresh]);

  const persistSetting = (key, value) =>
    saveSetting(db, key, value).catch((error) =>
      console.error("Could not save setting", key, error),
    );

  const visibleEntries = useMemo(() => {
    const filtered = applyFilters(entries, filters);
    if (!search.trim()) return filtered;
    return filtered.filter((entry) =>
      matchesQuery(
        `${entry.title || ""} ${entry.body || ""} ${(entry.tags || [])
          .map((tag) => tag.name)
          .join(" ")} ${entry.location?.name || ""} ${entry.location?.address || ""}`,
        search,
      ),
    );
  }, [entries, filters, search]);
  const calendarEntries = useMemo(
    () => entries.filter((entry) => entry.journal_date === selectedDate),
    [entries, selectedDate],
  );

  const setDailyMood = async (mood) => {
    const nextMood = dailyMoods[today] === mood ? null : mood;
    try {
      await saveDailyMood(db, today, nextMood);
      setDailyMoods((previous) => {
        const next = { ...previous };
        if (nextMood) next[today] = nextMood;
        else delete next[today];
        return next;
      });
    } catch (error) {
      Alert.alert(t.saveFailed, t.moodSaveFailed);
      console.error(error);
    }
  };

  const openNew = (date = today) => {
    setEditing(null);
    setEditorDate(date);
    setEditorVisible(true);
  };
  const openEdit = (entry) => {
    setEditing(entry);
    setEditorDate(entry.journal_date);
    setEditorVisible(true);
  };
  const closeEditor = () => {
    setEditorVisible(false);
    refresh().catch(console.error);
  };
  const toggleFavorite = async (entry) => {
    try {
      await setFavorite(db, entry.id, !entry.favorite);
      await refresh();
    } catch (error) {
      Alert.alert(t.saveFailed, t.saveFailedHint);
      console.error(error);
    }
  };

  const onEntryDeleted = (deleted) => {
    clearTimeout(undoTimer.current);
    setUndo(deleted);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };
  const undoDelete = async () => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    const { id } = undo;
    setUndo(null);
    try {
      await restoreEntry(db, id);
      await refresh();
    } catch (error) {
      Alert.alert(t.saveFailed, t.saveFailedHint);
      console.error(error);
    }
  };
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  // The undo bar would cover the buttons of Trash / Tags; the Trash screen has its own Restore.
  useEffect(() => {
    if (subScreen || settingsOpen) {
      clearTimeout(undoTimer.current);
      setUndo(null);
    }
  }, [subScreen, settingsOpen]);

  const changeLanguage = (value) => {
    setLanguage(value);
    persistSetting("language", value);
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
    persistSetting("calendarType", value);
    const nextCalendar =
      value === "default"
        ? language === "fa"
          ? "solarHijri"
          : "gregorian"
        : value;
    setCalendarMonth(getCalendarParts(selectedDate, nextCalendar));
  };
  const changeAppearance = (value) => {
    setAppearance(value);
    persistSetting("appearance", value);
  };
  const openTab = (value) => {
    setSubScreen(null);
    if (value === "settings") {
      setSettingsOpen(true);
      return;
    }
    setTab(value);
    setSettingsOpen(false);
  };
  const toggleSettings = () => {
    setSubScreen(null);
    setSettingsOpen((v) => !v);
  };
  // Open an entry by id (from Memories). The list is already in memory.
  const openEntryById = (id) => {
    const entry = entries.find((e) => e.id === id);
    if (entry) openEdit(entry);
  };

  // Android hardware/gesture Back: sub-screen -> settings -> Home -> exit.
  // (The editor and photo viewer are Modals and handle Back themselves.)
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (editorVisible) return false;
      if (subScreen) {
        setSubScreen(null);
        return true;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (tab !== "home") {
        setTab("home");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [editorVisible, subScreen, settingsOpen, tab]);

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
      {!isLandscapeTablet && (
        <Pressable
          onPress={toggleSettings}
          style={styles.topIcon}
          accessibilityLabel={t.settings}
        >
          <Settings2 size={21} color={c.muted} />
        </Pressable>
      )}
    </View>
  );

  let content;
  if (!ready)
    content = (
      <View style={styles.loading}>
        <Text style={{ color: c.muted }}>{t.preparing}</Text>
      </View>
    );
  else if (loadError)
    content = (
      <View style={styles.loading}>
        <EmptyState c={c} title={t.loadFailed} hint={t.loadFailedHint} />
      </View>
    );
  else if (settingsOpen && subScreen === "trash")
    content = (
      <TrashScreen
        db={db}
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        calendar={effectiveCalendar}
        onBack={() => setSubScreen(null)}
        onChanged={refresh}
      />
    );
  else if (settingsOpen && subScreen === "backup")
    content = (
      <BackupScreen
        db={db}
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        calendar={effectiveCalendar}
        onBack={() => setSubScreen(null)}
        onChanged={refresh}
      />
    );
  else if (settingsOpen && subScreen === "storage")
    content = (
      <StorageScreen
        db={db}
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        onBack={() => setSubScreen(null)}
        onChanged={refresh}
      />
    );
  else if (settingsOpen && subScreen === "tags")
    content = (
      <TagsScreen
        db={db}
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        onBack={() => setSubScreen(null)}
        onChanged={refresh}
      />
    );
  else if (settingsOpen)
    content = (
      <SettingsScreen
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        changeLanguage={changeLanguage}
        calendarType={calendarType}
        changeCalendar={changeCalendar}
        appearance={appearance}
        setAppearance={changeAppearance}
        onOpen={setSubScreen}
        trashCount={trashCount}
        num={numberFormatter(language)}
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
        filters={filters}
        setFilters={setFilters}
        tags={allTags}
        entries={visibleEntries}
        isSearching={Boolean(search.trim()) || hasActiveFilters(filters)}
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
        dailyMoods={dailyMoods}
        selectedEntries={calendarEntries}
        onNew={() => openNew(selectedDate)}
        onEdit={openEdit}
        onFavorite={toggleFavorite}
      />
    );
  else if (tab === "memories")
    content = (
      <MemoriesScreen
        db={db}
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        calendar={effectiveCalendar}
        refreshKey={entries}
        onOpenEntry={openEntryById}
        onChanged={refresh}
        insets={insets}
      />
    );
  else
    content = (
      <InsightsScreen
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        calendar={effectiveCalendar}
        today={today}
        entries={entries}
        dailyMoods={dailyMoods}
      />
    );

  const dockLabels = {
    home: t.home,
    calendar: t.calendar,
    memories: t.memories,
    insights: t.insights,
    settings: t.settings,
  };

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
            {isLandscapeTablet && <View style={{ width: 88, flexShrink: 0 }} />}
            {isLandscapeTablet && (
              <Dock
                activeTab={settingsOpen ? "settings" : tab}
                onTabPress={openTab}
                colors={c}
                vertical
                safeBottom={insets.bottom}
                rtl={rtl}
                labels={dockLabels}
              />
            )}
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
              <Animated.View
                key={subScreen || (settingsOpen ? "settings" : tab)}
                entering={fadeIn(0, 240)}
                style={{ flex: 1 }}
              >
                {content}
              </Animated.View>
            </View>
          </View>
          {!editorVisible && !isLandscapeTablet && (
            <Dock
              activeTab={settingsOpen ? "" : tab}
              onTabPress={openTab}
              colors={c}
              rtl={rtl}
              safeBottom={insets.bottom}
              labels={dockLabels}
            />
          )}
          {undo && (
            <Animated.View
              entering={slideInUp()}
              exiting={slideOutDown()}
              accessibilityLiveRegion="polite"
              style={[
                styles.undoBar,
                {
                  backgroundColor: c.ink,
                  bottom: (isLandscapeTablet ? 90 : 160) + insets.bottom,
                },
                rtl && styles.rowReverse,
              ]}
            >
              <Text style={{ color: c.paper, fontSize: 12, flex: 1 }}>
                {t.entryDeleted}
              </Text>
              <Pressable
                onPress={undoDelete}
                accessibilityRole="button"
                style={styles.undoButton}
              >
                <Text style={{ color: c.sage, fontWeight: "700", fontSize: 12 }}>
                  {t.undo}
                </Text>
              </Pressable>
            </Animated.View>
          )}
          {!settingsOpen && ready && !loadError && tab !== "memories" && (
            <PressableScale
              entering={zoomIn(250)}
              scaleTo={0.9}
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
            </PressableScale>
          )}
        </View>
      </View>
      <EditorModal
        visible={editorVisible}
        entry={editing}
        initialDate={editorDate}
        onClose={closeEditor}
        onChanged={refresh}
        onDeleted={onEntryDeleted}
        allTags={allTags}
        t={t}
        c={c}
        rtl={rtl}
        language={language}
        calendar={effectiveCalendar}
        dark={dark}
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
  filters,
  setFilters,
  tags,
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
        <PressableScale
          key={mood.key}
          onPress={() => onMood(mood.key)}
          accessibilityRole="button"
          accessibilityState={{ selected: dailyMood === mood.key }}
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
          <Pop active={dailyMood === mood.key}>
            <Text style={styles.moodEmoji}>{mood.face}</Text>
          </Pop>
          <Text
            numberOfLines={1}
            style={[
              styles.moodLabel,
              { color: dailyMood === mood.key ? c.sageDark : c.muted },
            ]}
          >
            {t[mood.key]}
          </Text>
        </PressableScale>
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
          rtl && isTablet && styles.rowReverse,
        ]}
      >
        <View style={styles.homeColumn}>
          <Animated.View
            entering={fadeInDown(0)}
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
            entering={fadeInDown(70)}
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
              entering={fadeInDown(140)}
              style={[
                styles.writeCard,
                { backgroundColor: c.write, borderColor: c.line },
                rtl && styles.rowReverse,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.writeKicker, { color: c.muted }]}>
                  {t.writeKicker}
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
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            tags={tags}
            t={t}
            c={c}
            rtl={rtl}
          />
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
  dailyMoods,
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
            const dayMood = MOODS.find((m) => m.key === dailyMoods[key]);
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
                accessibilityLabel={`${formatDateKey(key, language, calendar, {
                  dateStyle: "full",
                })}${dayMood ? `, ${t[dayMood.key]}` : ""}${hasEntry ? `, ${t.entries}` : ""}`}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    { color: selected ? c.sageDark : c.ink },
                  ]}
                >
                  {dayText}
                </Text>
                <View style={styles.dayMarks}>
                  {dayMood ? (
                    <Text style={styles.dayMoodFace}>{dayMood.face}</Text>
                  ) : null}
                  {hasEntry ? (
                    <View
                      style={[styles.dayDot, { backgroundColor: c.accent }]}
                    />
                  ) : null}
                </View>
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
        {dailyMoods[selectedDate] ? (
          <Text style={[styles.calendarNote, { color: c.sageDark, marginTop: 4 }]}>
            {t.dailyMoodLabel}:{" "}
            {MOODS.find((m) => m.key === dailyMoods[selectedDate])?.face}{" "}
            {t[dailyMoods[selectedDate]]}
          </Text>
        ) : null}
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
  const num = numberFormatter(language);
  return (
    <View style={styles.entryList}>
      {entries.map((entry, index) => (
        <Animated.View
          key={entry.id}
          entering={fadeInDown(stagger(index))}
          layout={listLayout()}
          style={[
            styles.entryCard,
            { backgroundColor: c.card, borderColor: c.line },
            rtl && styles.rowReverse,
          ]}
        >
          <PressableScale scaleTo={0.985} onPress={() => onEdit(entry)} style={{ flex: 1 }}>
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
            {entry.tags?.length ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.entryTags,
                  { color: c.sageDark, textAlign: rtl ? "right" : "left" },
                ]}
              >
                {entry.tags.map((tag) => `#${tag.name}`).join("  ")}
              </Text>
            ) : null}
            {entry.attachmentCount || entry.location || entry.emotions?.length ? (
              <View style={[styles.entryMeta, rtl && styles.rowReverse]}>
                {entry.attachmentCount ? (
                  <View style={[styles.metaItem, rtl && styles.rowReverse]}>
                    <ImageIcon size={11} color={c.muted} />
                    <Text style={{ color: c.muted, fontSize: 10 }}>
                      {num(entry.attachmentCount)}
                    </Text>
                  </View>
                ) : null}
                {entry.location ? (
                  <View style={[styles.metaItem, rtl && styles.rowReverse, { flexShrink: 1 }]}>
                    <MapPin size={11} color={c.muted} />
                    <Text numberOfLines={1} style={{ color: c.muted, fontSize: 10, flexShrink: 1 }}>
                      {entry.location.name || entry.location.address || ""}
                    </Text>
                  </View>
                ) : null}
                {(entry.emotions || []).slice(0, 4).map((em) => (
                  <Text key={em.key} style={{ fontSize: 11 }}>
                    {EMOTIONS.find((x) => x.key === em.key)?.face}
                  </Text>
                ))}
              </View>
            ) : null}
          </PressableScale>
          {entry.pinned ? (
            <Pin size={14} color={c.sageDark} fill={c.sageDark} />
          ) : null}
          {entry.mood ? (
            <Text style={styles.entryMood}>
              {MOODS.find((mood) => mood.key === entry.mood)?.face}
            </Text>
          ) : null}
          <PressableScale
            scaleTo={0.8}
            onPress={() => onFavorite(entry)}
            style={styles.entryAction}
            accessibilityLabel={entry.favorite ? t.removeFavorite : t.favorite}
          >
            <Pop active={Boolean(entry.favorite)}>
              <Star
                size={17}
                color={entry.favorite ? "#B78E57" : c.muted}
                fill={entry.favorite ? "#B78E57" : "transparent"}
              />
            </Pop>
          </PressableScale>
        </Animated.View>
      ))}
    </View>
  );
}

function InsightsScreen({
  t,
  c,
  rtl,
  language,
  calendar,
  today,
  entries,
  dailyMoods,
}) {
  const localeTag =
    language === "fa" ? "fa-IR" : language === "tr" ? "tr-TR" : "en-US";
  const num = (value) => new Intl.NumberFormat(localeTag).format(value);
  const [trackWidth, setTrackWidth] = useState(0);
  const monthOf = (key) => {
    const p = getCalendarParts(key, calendar);
    return `${p.year}-${p.month}`;
  };
  const thisMonth = monthOf(today);
  const monthEntries = entries.filter(
    (entry) => monthOf(entry.journal_date) === thisMonth,
  );
  const writingDays = new Set(monthEntries.map((entry) => entry.journal_date))
    .size;
  // Only days with a recorded mood are counted; a missing mood is never "neutral".
  // One mood per day: the Home "How are you feeling today?" choice wins; otherwise
  // the mood picked in that day's most recently edited entry is used.
  const dayMoods = { ...dailyMoods };
  const latestByDay = {};
  for (const entry of entries) {
    if (!entry.mood || dayMoods[entry.journal_date]) continue;
    const prev = latestByDay[entry.journal_date];
    if (!prev || String(entry.updated_at) > String(prev.updated_at)) latestByDay[entry.journal_date] = entry;
  }
  for (const [day, entry] of Object.entries(latestByDay)) dayMoods[day] = entry.mood;
  const moodCounts = MOODS.map((mood) => ({
    ...mood,
    count: Object.values(dayMoods).filter((value) => value === mood.key).length,
  }));
  const moodTotal = moodCounts.reduce((sum, mood) => sum + mood.count, 0);
  const stats = [
    [entries.length, t.entries, BookOpen],
    [entries.filter((entry) => entry.favorite).length, t.favorites, Star],
    [moodTotal, t.moods, Heart],
  ];
  const monthStats = [
    [monthEntries.length, t.thisMonthEntries],
    [writingDays, t.writingDays],
  ];
  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <Text style={[styles.eyebrow, { color: c.muted }]}>{t.insights}</Text>
      <Text style={[styles.pageTitle, { color: c.ink }]}>{t.insights}</Text>
      <View style={[styles.insightGrid, rtl && styles.rowReverse]}>
        {stats.map(([number, label, Icon], i) => (
          <View
            key={`stat-${i}`}
            style={[
              styles.insightCard,
              { backgroundColor: c.card, borderColor: c.line },
            ]}
          >
            <Icon size={19} color={c.sageDark} />
            <Text style={[styles.statNumber, { color: c.sageDark }]}>
              {num(number)}
            </Text>
            <Text style={[styles.statLabel, { color: c.muted }]}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.insightGrid, rtl && styles.rowReverse]}>
        {monthStats.map(([number, label], i) => (
          <View
            key={`month-${i}`}
            style={[
              styles.insightCard,
              { backgroundColor: c.card, borderColor: c.line },
            ]}
          >
            <Text style={[styles.statNumber, { color: c.sageDark }]}>
              {num(number)}
            </Text>
            <Text style={[styles.statLabel, { color: c.muted }]}>{label}</Text>
          </View>
        ))}
      </View>
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
          {t.moodDistribution}
        </Text>
        {moodTotal === 0 ? (
          <Text style={[styles.settingNote, { color: c.muted }]}>
            {t.noMoodData}
          </Text>
        ) : (
          moodCounts.map((mood) => (
            <View
              key={mood.key}
              style={[styles.distRow, rtl && styles.rowReverse]}
              accessible
              accessibilityLabel={`${t[mood.key]}: ${num(mood.count)}`}
            >
              <Text style={styles.distFace}>{mood.face}</Text>
              <Text style={[styles.distLabel, { color: c.muted }]}>
                {t[mood.key]}
              </Text>
              <View
                style={[styles.distTrack, { backgroundColor: c.accentSoft }]}
                onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
              >
                <GrowBar
                  fraction={mood.count / moodTotal}
                  trackWidth={trackWidth}
                  color={c.accent}
                  rtl={rtl}
                />
              </View>
              <Text style={[styles.distCount, { color: c.ink }]}>
                {num(mood.count)}
              </Text>
            </View>
          ))
        )}
        <Text style={[styles.settingNote, { color: c.muted, marginTop: 0 }]}>
          {t.insightsHint}
        </Text>
      </View>
    </ScrollView>
  );
}

function darkenOr(lightColor, darkColor) {
  return lightColor === BASE.accentSoft ? "#F1F3EB" : darkColor;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="kitty-journal.db" onInit={runMigrations}>
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
  contentArea: { width: "100%", flex: 1, minWidth: 0, alignSelf: "center" },
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
    shadowColor: "#4C3C25",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 1,
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
    shadowColor: "#4C3C25",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 1,
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
  settingNote: { fontSize: 11, lineHeight: 17, marginTop: 5 },
  entryMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  entryTags: { fontSize: 10, marginTop: 5, fontWeight: "600" },
  dayMarks: {
    minHeight: 11,
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  dayMoodFace: { fontSize: 9 },
  distRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  distFace: { fontSize: 16, width: 22, textAlign: "center" },
  distLabel: { fontSize: 10, width: 58 },
  distTrack: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  distFill: { height: 8, borderRadius: 4 },
  distCount: { fontSize: 11, fontWeight: "600", minWidth: 22, textAlign: "center" },
  undoBar: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    elevation: 8,
    zIndex: 40,
  },
  undoButton: { paddingVertical: 6, paddingHorizontal: 8, minHeight: 32, justifyContent: "center" },
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
});
