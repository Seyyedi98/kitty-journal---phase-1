import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useSQLiteContext } from 'expo-sqlite';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Heart,
  Image as ImageIcon,
  MapPin,
  Pin,
  Plus,
  RotateCw,
  Smile,
  Star,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react-native';
import { ScrollView, Text, TextInput } from '../ui';
import { Animated, PressableScale, fadeInDown } from '../motion';
import { MOODS } from '../theme';
import { dateKey, formatDateKey, parseDateKey } from '../calendar';
import {
  cleanLocation,
  listEntryAttachments,
  saveEntry,
  setFavorite,
  setPinned,
  softDeleteEntry,
} from '../db/repository';
import { importPhotos, attachmentUri, purgeEntryAndFiles, removeAttachmentAndFiles } from '../services/photos';
import { deps } from '../platform/deps';
import { pickPhotos } from '../platform/pickers';
import { getCurrentPlace } from '../platform/location';
import { useAutosave } from '../hooks/useAutosave';
import { cleanTagName, countWords, readingMinutes, tagKey } from '../utils/text';
import { cleanEmotions } from '../utils/emotions';
import { fmt } from '../i18n';
import PhotoStrip from './PhotoStrip';
import PhotoViewer from './PhotoViewer';
import EmotionPicker from './EmotionPicker';
import PlaceField from './PlaceField';
import RichEditor from './RichEditor';
import RichToolbar from './RichToolbar';
import { entryToEditorHtml, htmlToPlainText, isHtmlEmpty } from '../utils/richText';

const fs = deps.fs;

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

function shiftDay(key, amount) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + amount);
  return dateKey(d);
}

/**
 * Autosaving editor. It owns its own form state; every change is written to
 * SQLite (debounced) and the "Saved" label only appears after the commit.
 * A brand-new entry is created in the database on the first non-empty
 * autosave and then updated in place, so recovery after a crash never
 * produces duplicates.
 */
function Section({ icon: Icon, title, hint, c, rtl, children, index = 0 }) {
  const align = rtl ? 'right' : 'left';
  return (
    <Animated.View entering={fadeInDown(120 + index * 60)} style={[s.section, { backgroundColor: c.card, borderColor: c.line }]}>
      <View style={[s.sectionHead, rtl && s.rowReverse]}>
        <View style={[s.sectionIcon, { backgroundColor: c.sage }]}>
          <Icon size={14} color={c.sageDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 13, fontWeight: '700', textAlign: align }}>{title}</Text>
          {hint ? <Text style={{ color: c.muted, fontSize: 10, marginTop: 1, textAlign: align }}>{hint}</Text> : null}
        </View>
      </View>
      {children}
    </Animated.View>
  );
}

export default function EditorModal({
  visible,
  entry,
  initialDate,
  onClose,
  onChanged,
  onDeleted,
  allTags,
  t,
  c,
  rtl,
  language,
  calendar,
  dark,
  insets,
  runExternal = (fn) => fn(),
}) {
  const db = useSQLiteContext();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState(''); // plain text, derived from bodyHtml (word count, empty checks)
  const [bodyHtml, setBodyHtml] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [initialHtml, setInitialHtml] = useState('');
  const [fmtState, setFmtState] = useState({});
  const [mood, setMood] = useState(null);
  const [tags, setTags] = useState([]);
  const [emotions, setEmotions] = useState([]);
  const [place, setPlace] = useState(null);
  const [date, setDate] = useState(initialDate);
  const [favorite, setFavoriteState] = useState(false);
  const [pinned, setPinnedState] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [photos, setPhotos] = useState([]);
  const [importing, setImporting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [placeMessage, setPlaceMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [photoMessage, setPhotoMessage] = useState('');
  const [viewerIndex, setViewerIndex] = useState(null);

  const richRef = useRef(null);
  const scrollRef = useRef(null);
  const scrollY = useRef(0);
  const editorWrap = useRef(null);
  const entryIdRef = useRef(null);
  const createdHere = useRef(false);
  const deletedRef = useRef(false);

  const values = useMemo(
    () => ({ title, bodyHtml, mood, tags, emotions, place, date }),
    [title, bodyHtml, mood, tags, emotions, place, date],
  );

  const persist = useCallback(
    async (v) => {
      if (deletedRef.current) return;
      const cleanPlace = cleanLocation(v.place);
      const hasContent = v.title.trim() || !isHtmlEmpty(v.bodyHtml) || v.tags.length || v.emotions.length || cleanPlace;
      if (!entryIdRef.current && !hasContent) return; // nothing worth creating yet
      const wasNew = !entryIdRef.current;
      let id;
      try {
        id = await saveEntry(db, {
        id: entryIdRef.current,
        title: v.title,
        bodyHtml: v.bodyHtml,
        journal_date: v.date,
        mood: v.mood,
        tags: v.tags,
        emotions: cleanEmotions(v.emotions),
        location: cleanPlace,
        });
      } catch (error) {
        console.warn('[kitty-journal] save failed:', error);
        setSaveError(String((error && error.message) || error).slice(0, 160));
        throw error;
      }
      setSaveError('');
      entryIdRef.current = id;
      if (wasNew) createdHere.current = true;
      onChanged?.();
    },
    [db, onChanged],
  );

  const autosave = useAutosave({ active: visible, values, persist });
  const { reset: resetAutosave } = autosave;

  // (Re)initialise the form whenever the editor opens.
  useEffect(() => {
    if (!visible) return;
    const start = {
      title: entry?.title || '',
      bodyHtml: entryToEditorHtml(entry),
      mood: entry?.mood || null,
      tags: (entry?.tags || []).map((x) => x.name),
      emotions: cleanEmotions(entry?.emotions),
      place: entry?.location
        ? {
            name: entry.location.name || '',
            address: entry.location.address || '',
            latitude: entry.location.latitude ?? null,
            longitude: entry.location.longitude ?? null,
          }
        : null,
      date: entry?.journal_date || initialDate,
    };
    entryIdRef.current = entry?.id ?? null;
    createdHere.current = false;
    deletedRef.current = false;
    setTitle(start.title);
    setBody(entry?.body || '');
    setBodyHtml(start.bodyHtml);
    setInitialHtml(start.bodyHtml);
    setEditorKey((k) => k + 1);
    setFmtState({});
    setMood(start.mood);
    setTags(start.tags);
    setEmotions(start.emotions);
    setPlace(start.place);
    setDate(start.date);
    setFavoriteState(Boolean(entry?.favorite));
    setPinnedState(Boolean(entry?.pinned));
    setTagDraft('');
    setPhotos([]);
    setPlaceMessage('');
    setPhotoMessage('');
    setViewerIndex(null);
    resetAutosave(start);
    if (entry?.id) {
      listEntryAttachments(db, entry.id)
        .then(setPhotos)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry?.id]);

  const isEmptyDraft = () =>
    !title.trim() && !body.trim() && !tags.length && !emotions.length && !cleanLocation(place) && photos.length === 0;

  const closeEditor = async () => {
    if (importing) return; // a photo is being copied; wait for it to finish
    try {
      await autosave.flush();
    } catch {
      // Write failed: stay open so the text is not lost; the banner offers a retry.
      Alert.alert(t.saveFailed, t.saveFailedHint);
      return;
    }
    // Discard an entry that was created in this session but is now empty.
    if (createdHere.current && entryIdRef.current && isEmptyDraft()) {
      try {
        await purgeEntryAndFiles(db, fs, entryIdRef.current);
        onChanged?.();
      } catch {
        /* an empty leftover row is harmless */
      }
    }
    onClose();
  };

  const ensureSaved = async () => {
    try {
      await autosave.flush();
    } catch {
      return null;
    }
    return entryIdRef.current;
  };

  /** Like ensureSaved, but creates the entry row first when it does not exist yet. */
  const ensureEntryExists = async () => {
    const existing = await ensureSaved();
    if (existing) return existing;
    if (autosave.status === 'error') return null;
    try {
      const id = await saveEntry(db, {
        id: null,
        title,
        bodyHtml,
        journal_date: date,
        mood,
        tags,
        emotions: cleanEmotions(emotions),
        location: cleanLocation(place),
      });
      entryIdRef.current = id;
      createdHere.current = true;
      onChanged?.();
      return id;
    } catch {
      return null;
    }
  };

  const reloadPhotos = async (id) => {
    try {
      setPhotos(await listEntryAttachments(db, id));
    } catch {
      /* the strip keeps showing the previous list */
    }
  };

  const addPhotos = async () => {
    if (importing) return;
    setPhotoMessage('');
    let assets;
    try {
      assets = await runExternal(() => pickPhotos({ limit: 10 }));
    } catch {
      setPhotoMessage(t.photoImportFailed);
      return;
    }
    if (!assets.length) return;
    setImporting(true);
    try {
      const id = await ensureEntryExists();
      if (!id) {
        setPhotoMessage(t.saveFailedHint);
        return;
      }
      const { added, failed } = await importPhotos(db, deps, id, assets);
      await reloadPhotos(id);
      onChanged?.();
      if (failed.length) {
        const noSpace = failed.some((f) => f.code === 'no-space');
        console.warn('[kitty-journal] photo import failed:', failed.map((f) => f.message).join(' | '));
        setPhotoMessage(
          `${noSpace ? t.photoNoSpace : t.photoImportFailed} ${fmt(t.photosFailed, { n: num(failed.length) })}\n${String(failed[0].message).slice(0, 180)}`,
        );
      } else if (added.length) {
        setPhotoMessage(fmt(t.photoAdded, { n: num(added.length) }));
      }
    } finally {
      setImporting(false);
    }
  };

  const removePhoto = (photo) => {
    Alert.alert(t.photoRemove, t.photoRemoveConfirm, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.photoRemove,
        style: 'destructive',
        onPress: async () => {
          try {
            await removeAttachmentAndFiles(db, fs, photo.id);
            await reloadPhotos(entryIdRef.current);
            onChanged?.();
          } catch {
            setPhotoMessage(t.somethingWrong);
          }
        },
      },
    ]);
  };

  const useCurrentLocation = async () => {
    if (locating) return;
    setPlaceMessage('');
    setLocating(true);
    try {
      const result = await runExternal(() => getCurrentPlace());
      if (!result.ok) {
        setPlaceMessage(result.reason === 'denied' ? t.locationDenied : t.locationUnavailable);
        return;
      }
      setPlace((prev) => ({
        name: (prev && prev.name) || result.name || '',
        address: result.address || '',
        latitude: result.latitude,
        longitude: result.longitude,
      }));
    } finally {
      setLocating(false);
    }
  };

  const toggleFavorite = async () => {
    const id = await ensureSaved();
    if (!id) return;
    const next = !favorite;
    try {
      await setFavorite(db, id, next);
      setFavoriteState(next);
      onChanged?.();
    } catch {
      Alert.alert(t.saveFailed, t.saveFailedHint);
    }
  };

  const togglePinned = async () => {
    const id = await ensureSaved();
    if (!id) return;
    const next = !pinned;
    try {
      await setPinned(db, id, next);
      setPinnedState(next);
      onChanged?.();
    } catch {
      Alert.alert(t.saveFailed, t.saveFailedHint);
    }
  };

  const confirmDelete = () => {
    const id = entryIdRef.current;
    if (!id) {
      onClose();
      return;
    }
    Alert.alert(t.delete, `${t.deleteConfirm}\n${t.deleteConfirmSoft}`, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.delete,
        style: 'destructive',
        onPress: async () => {
          try {
            await autosave.flush().catch(() => {});
            deletedRef.current = true;
            await softDeleteEntry(db, id);
            onChanged?.();
            onDeleted?.({ id, title });
            onClose();
          } catch {
            deletedRef.current = false;
            Alert.alert(t.saveFailed, t.saveFailedHint);
          }
        },
      },
    ]);
  };

  const addTag = (raw) => {
    const name = cleanTagName(raw);
    if (!name) return;
    setTags((prev) => (prev.some((x) => tagKey(x) === tagKey(name)) ? prev : [...prev, name]));
    setTagDraft('');
  };
  const onBodyChange = useCallback((html) => {
    setBodyHtml(html);
    setBody(htmlToPlainText(html));
  }, []);

  // Keep the caret above the toolbar/keyboard while typing at the bottom of a long entry.
  const keepCaretVisible = useCallback((y) => {
    const wrap = editorWrap.current;
    const sv = scrollRef.current;
    if (!wrap || !sv || !wrap.measureInWindow || !sv.measureInWindow) return;
    wrap.measureInWindow((_x, wy) => {
      sv.measureInWindow((_sx, sy, _sw, sh) => {
        const caretAbs = wy + y;
        const limit = sy + sh - 64;
        if (caretAbs > limit && sv.scrollTo) sv.scrollTo({ y: scrollY.current + (caretAbs - limit), animated: true });
        else if (caretAbs < sy + 8 && sv.scrollTo) sv.scrollTo({ y: Math.max(0, scrollY.current - (sy + 8 - caretAbs) - 40), animated: true });
      });
    });
  }, []);

  const removeTag = (name) => setTags((prev) => prev.filter((x) => x !== name));

  const suggestions = useMemo(() => {
    const chosen = new Set(tags.map(tagKey));
    return (allTags || []).filter((x) => !chosen.has(tagKey(x.name))).slice(0, 8);
  }, [allTags, tags]);

  const localeTag = language === 'fa' ? 'fa-IR' : language === 'tr' ? 'tr-TR' : 'en-US';
  const words = countWords(body);
  const minutes = readingMinutes(words);
  const num = (n) => new Intl.NumberFormat(localeTag).format(n);

  const hasAnything = Boolean(entryIdRef.current) || title.trim() || body.trim() || tags.length;
  const statusLabel =
    autosave.status === 'saving'
      ? t.saving
      : autosave.status === 'saved'
        ? t.savedAuto
        : autosave.status === 'dirty'
          ? t.unsaved
          : autosave.status === 'error'
            ? t.saveFailed
            : '';
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const align = rtl ? 'right' : 'left';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditor}>
      <View style={[s.root, { backgroundColor: c.paper, paddingTop: insets.top }]}>
        <ExpoStatusBar style={dark ? 'light' : 'dark'} backgroundColor={c.paper} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.header, { borderBottomColor: c.line }, rtl && s.rowReverse]}>
            <PressableScale
              onPress={closeEditor}
              style={[s.doneButton, { backgroundColor: c.sage }, rtl && s.rowReverse]}
              accessibilityRole="button"
              accessibilityLabel={t.done}
            >
              <ArrowLeft size={16} color={c.sageDark} style={rtl ? { transform: [{ scaleX: -1 }] } : null} />
              <Text style={{ color: c.sageDark, fontWeight: '700', fontSize: 13 }}>{t.done}</Text>
            </PressableScale>
            <View style={s.headerCenter}>
              <Text style={[s.headerTitle, { color: c.ink }]}>{entry ? t.edit : t.newEntry}</Text>
              {hasAnything && statusLabel ? (
                autosave.status === 'error' ? (
                  <Pressable onPress={() => autosave.retry().catch(() => {})} style={[s.retry, rtl && s.rowReverse]}>
                    <RotateCw size={11} color={c.danger} />
                    <Text style={{ color: c.danger, fontSize: 10, fontWeight: '700' }}>
                      {t.saveFailed} · {t.retry}
                    </Text>
                  </Pressable>
                ) : (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{ color: autosave.status === 'saved' ? c.sageDark : c.muted, fontSize: 10, fontWeight: '600' }}
                  >
                    {statusLabel}
                  </Text>
                )
              ) : null}
            </View>
            <View style={[s.headerActions, rtl && s.rowReverse]}>
              <Pressable
                onPress={togglePinned}
                style={s.iconButton}
                accessibilityRole="button"
                accessibilityLabel={pinned ? t.unpin : t.pin}
                accessibilityState={{ selected: pinned }}
              >
                <Pin size={18} color={pinned ? c.sageDark : c.muted} fill={pinned ? c.sageDark : 'transparent'} />
              </Pressable>
              <Pressable
                onPress={toggleFavorite}
                style={s.iconButton}
                accessibilityRole="button"
                accessibilityLabel={favorite ? t.removeFavorite : t.favorite}
                accessibilityState={{ selected: favorite }}
              >
                <Star size={18} color={favorite ? c.star : c.muted} fill={favorite ? c.star : 'transparent'} />
              </Pressable>
            </View>
          </View>

          {autosave.status === 'error' && saveError ? (
            <Text selectable style={{ color: c.danger, fontSize: 10, paddingHorizontal: 16, paddingTop: 6, textAlign: rtl ? 'right' : 'left' }}>
              {saveError}
            </Text>
          ) : null}
          <ScrollView
            ref={scrollRef}
            onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={32}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={s.content}
          >
            <View style={[s.dateRow, { backgroundColor: c.card, borderColor: c.line }, rtl && s.rowReverse]}>
              <Pressable
                onPress={() => setDate((d) => shiftDay(d, -1))}
                style={[s.dayArrow, { backgroundColor: c.sage }]}
                accessibilityRole="button"
                accessibilityLabel={t.previousDay}
              >
                <Prev size={16} color={c.sageDark} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[s.dateLabel, { color: c.muted }]}>{t.journalDate}</Text>
                <Text style={[s.dateValue, { color: c.ink }]}>
                  {formatDateKey(date, language, calendar, { dateStyle: 'full' })}
                </Text>
              </View>
              <Pressable
                onPress={() => setDate((d) => shiftDay(d, 1))}
                style={[s.dayArrow, { backgroundColor: c.sage }]}
                accessibilityRole="button"
                accessibilityLabel={t.nextDay}
              >
                <Next size={16} color={c.sageDark} />
              </Pressable>
            </View>

            <View style={[s.writing, { backgroundColor: c.card, borderColor: c.line }]}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t.title}
                placeholderTextColor={c.muted}
                style={[s.titleInput, { color: c.ink, borderBottomColor: c.line, textAlign: align }]}
              />
              <View ref={editorWrap} collapsable={false} style={s.bodyWrap}>
                {editorKey > 0 ? (
                  <RichEditor
                    key={`${editorKey}-${dark ? 'd' : 'l'}`}
                    ref={richRef}
                    html={initialHtml}
                    rtl={rtl}
                    placeholder={t.body}
                    colors={{ ink: c.ink, muted: c.muted, line: c.line, accent: c.sageDark, selection: c.sage }}
                    onChange={onBodyChange}
                    onState={setFmtState}
                    onCaret={keepCaretVisible}
                  />
                ) : null}
              </View>
              <View style={[s.metaRow, { borderTopColor: c.line }, rtl && s.rowReverse]}>
                <Text style={{ color: c.muted, fontSize: 10 }}>
                  {num(words)} {t.words}
                  {words > 0 ? ` · ${num(minutes)} ${t.minRead}` : ''}
                </Text>
              </View>
            </View>

            <Section icon={ImageIcon} title={t.photos} c={c} rtl={rtl} index={0}>
            <PhotoStrip
              photos={photos}
              uriFor={(p) => attachmentUri(fs, p.thumb_name || p.file_name)}
              onAdd={addPhotos}
              onOpen={(i) => setViewerIndex(i)}
              onRemove={removePhoto}
              busy={importing}
              t={t}
              c={c}
              rtl={rtl}
            />
            {photoMessage ? (
              <Text accessibilityLiveRegion="polite" style={{ color: c.muted, fontSize: 10, textAlign: align }}>
                {photoMessage}
              </Text>
            ) : null}
            </Section>

            <Section icon={TagIcon} title={t.tags} c={c} rtl={rtl} index={1}>
            <View style={[s.chipRow, rtl && s.rowReverse]}>
              {tags.map((name) => (
                <Pressable
                  key={tagKey(name)}
                  onPress={() => removeTag(name)}
                  style={[s.chip, { backgroundColor: c.sage, borderColor: c.sageDark }, rtl && s.rowReverse]}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.removeTag}: ${name}`}
                >
                  <Text style={{ color: c.sageDark, fontSize: 11, fontWeight: '600' }}>#{name}</Text>
                  <X size={12} color={c.sageDark} />
                </Pressable>
              ))}
            </View>
            <View style={[s.tagInputRow, { backgroundColor: c.card, borderColor: c.line }, rtl && s.rowReverse]}>
              <TextInput
                value={tagDraft}
                onChangeText={setTagDraft}
                onSubmitEditing={() => addTag(tagDraft)}
                placeholder={t.tagPlaceholder}
                placeholderTextColor={c.muted}
                returnKeyType="done"
                blurOnSubmit={false}
                autoCapitalize="none"
                style={[s.tagInput, { color: c.ink, textAlign: align }]}
              />
              <Pressable onPress={() => addTag(tagDraft)} style={s.iconButton} accessibilityRole="button" accessibilityLabel={t.addTag}>
                <Plus size={18} color={c.sageDark} />
              </Pressable>
            </View>
            {suggestions.length ? (
              <View>
                <Text style={{ color: c.muted, fontSize: 10, marginBottom: 6, textAlign: align }}>{t.suggestedTags}</Text>
                <View style={[s.chipRow, rtl && s.rowReverse]}>
                  {suggestions.map((tag) => (
                    <Pressable
                      key={tag.id}
                      onPress={() => addTag(tag.name)}
                      style={[s.chip, { backgroundColor: c.card, borderColor: c.line }]}
                      accessibilityRole="button"
                    >
                      <Text style={{ color: c.muted, fontSize: 11 }}>#{tag.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            </Section>

            <Section icon={Smile} title={t.entryMoodLabel} c={c} rtl={rtl} index={2}>
            <View style={[s.moodOptions, rtl && s.rowReverse]}>
              {MOODS.map((item) => {
                const selected = mood === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setMood(selected ? null : item.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t[item.key]}
                    style={[
                      s.moodOption,
                      {
                        backgroundColor: selected ? item.color : c.card,
                        borderColor: selected ? c.sageDark : c.line,
                      },
                    ]}
                  >
                    <Text style={s.moodEmoji}>{item.face}</Text>
                    <Text style={[s.moodLabel, { color: selected && !dark ? '#38352F' : c.muted }]}>{t[item.key]}</Text>
                  </Pressable>
                );
              })}
            </View>
            </Section>

            <Section icon={Heart} title={t.emotions} hint={t.emotionsHint} c={c} rtl={rtl} index={3}>
              <EmotionPicker value={emotions} onChange={setEmotions} t={t} c={c} rtl={rtl} num={num} />
            </Section>

            <Section icon={MapPin} title={t.location} c={c} rtl={rtl} index={4}>
            <PlaceField
              value={place}
              onChange={setPlace}
              onUseCurrent={useCurrentLocation}
              locating={locating}
              message={placeMessage}
              t={t}
              c={c}
              rtl={rtl}
            />
            </Section>

            {entry || entryIdRef.current ? (
              <Pressable onPress={confirmDelete} style={[s.deleteButton, { borderColor: c.danger }]} accessibilityRole="button">
                <Trash2 size={17} color={c.danger} />
                <Text style={{ color: c.danger, fontWeight: '600' }}>{t.delete}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
          <RichToolbar t={t} c={c} state={fmtState} onCommand={(cmd, arg) => richRef.current?.exec(cmd, arg)} bottomInset={Math.max(insets.bottom, 4)} />
        </KeyboardAvoidingView>
      </View>
      <PhotoViewer
        visible={viewerIndex !== null}
        photos={photos.map((p) => ({ id: p.id, uri: attachmentUri(fs, p.file_name) }))}
        index={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
        t={t}
        insets={insets}
        num={num}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  rowReverse: { flexDirection: 'row-reverse' },
  header: {
    minHeight: 60,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  doneButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 99, minHeight: 38 },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1 },
  headerTitle: { fontSize: 15, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, gap: 14, flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 18, padding: 8 },
  dayArrow: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dateLabel: { fontSize: 9, letterSpacing: 0.4, marginBottom: 2, textAlign: 'center' },
  dateValue: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  writing: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 18, paddingTop: 6, overflow: 'hidden' },
  titleInput: { fontFamily: SERIF, fontSize: 25, paddingVertical: 14, borderBottomWidth: 1 },
  bodyWrap: { minHeight: 220 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingVertical: 10 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  section: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    borderWidth: 1,
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    minHeight: 42,
  },
  tagInput: { flex: 1, minWidth: 0, paddingVertical: 9, fontSize: 12 },
  moodOptions: { flexDirection: 'row', gap: 7, marginTop: 4 },
  moodOption: {
    flex: 1,
    minWidth: 0,
    minHeight: 69,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 2,
    gap: 6,
  },
  moodEmoji: { fontSize: 20 },
  moodLabel: { fontSize: 9, fontWeight: '600', textAlign: 'center' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, marginTop: 6, borderWidth: 1, borderRadius: 16 },
});
