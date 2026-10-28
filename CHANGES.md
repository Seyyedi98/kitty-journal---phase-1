# Kitty Journal — فاز A (از ۳ فاز)

## تقسیم‌بندی فازها
- **فاز A (این بسته):** عکس‌ها + تب Memories واقعی، مکان‌ها، احساسات ثانویه، سطل زباله (Trash)، مدیریت تگ‌ها، دکمهٔ Back اندروید، اسکرول‌بار مخفی.
- **فاز B:** پشتیبان‌گیری و بازیابی JSON/ZIP، مدیریت فضا، یادآورها.
- **فاز C:** قفل برنامه (PIN + بیومتریک)، Onboarding، آمار غنی‌تر، تم‌های رنگی.

## نصب
فایل‌های این zip را روی پروژهٔ Expo خودتان کپی (merge) کنید (`App.js` و پوشهٔ `src/`)، سپس:

    npx expo install expo-image-picker expo-image-manipulator expo-file-system expo-location

و در `app.json`:

    "plugins": [
      ["expo-image-picker", { "photosPermission": "Kitty Journal needs access to your photos to attach them to entries." }],
      ["expo-location", { "locationWhenInUsePermission": "Kitty Journal uses your location only when you tap “Use current location”." }]
    ]

بعد از تغییر plugins یک بار `npx expo prebuild` / build جدید لازم است (Expo Go برای این پلاگین‌ها کافی نیست اگر نسخهٔ native لازم شود).
دیتابیس خودکار تا نسخهٔ ۴ مایگریت می‌شود؛ داده‌های قبلی حفظ می‌شوند.

## چه چیزی تست شده
- تست‌های منطقی (`npx tsx tests/run.mjs`, `logic.mjs`, `services.mjs`, `i18n-usage.mjs`): همه پاس.
- تست مرورگری سرتاسری (۱۷ سناریو: ذخیرهٔ خودکار، تگ، احساسات، مکان با/بدون مجوز، عکس موفق/لغو/خطا، Memories، حذف/Undo/Trash، مدیریت تگ، Back، فارسی): همه پاس.
- ⚠️ تست مرورگری با شبیه‌ساز ماژول‌های native اجرا شده، **نه روی دستگاه واقعی**. لطفاً روی گوشی هم امتحان کنید.

## محدودیت‌ها
- «نقشه» فعلاً فهرست مکان‌ها با لینک «Open in maps» است (نه نقشهٔ داخل برنامه).
- میان‌بر ایجاد سریع یادداشت از لانچر انجام نشده.

## یک باگ که حین تست پیدا و رفع شد
نوار Undo روی دکمه‌های صفحهٔ Trash/Tags می‌افتاد؛ حالا با باز شدن زیرصفحه بسته می‌شود.

## افزوده‌ها در نسخه‌های بعدی
- نقشهٔ واقعی در Memories (تب Map): Leaflet + OpenStreetMap داخل WebView؛ به‌جای پین، عکس کوچک یادداشت؛ با لمس، فهرست یادداشت‌های همان مکان.
  نصب: `npx expo install react-native-webview` (نیاز به اینترنت برای کاشی‌های نقشه؛ اسکریپت Leaflet از unpkg بارگذاری می‌شود).
- ترمیم خودکار دیتابیس: جدول قدیمی `attachments` (با ستون `uri`) به `attachments_legacy` منتقل و جدول درست ساخته می‌شود.

## Phase B · Step B1 — Backup export
- Settings → "Backup & restore": full ZIP backup (entries, moods, tags, places, photos) or text-only JSON.
- Result card with counts, size, missing-photo warning, and "Share / save a copy".
- "Last backup" is saved only after the share sheet was actually opened; reminder after 30 days.
- New packages: `npx expo install expo-sharing` and `npm i jszip`.
- Settings page bottom padding raised so the last rows are not hidden behind the dock.
- B1.1: 'Save to this phone' (Android folder picker, e.g. Downloads) next to Share.
- Tablet landscape: side dock now sits inside the body row (no overlap with content/top bar); removed duplicate Settings icon from the top bar on tablet.

## Rich editor — part 1 of 2
- Entry body is now a WebView editor (offline) with a toolbar: undo/redo, bold, italic, underline, strikethrough, two heading sizes, bulleted and numbered lists.
- Each paragraph picks its own direction automatically (Persian/Arabic paragraphs right-aligned, English/Turkish left-aligned, in the same entry).
- Storage: new `entries.body_html` (migration v5) holds sanitised HTML; `body` stays the plain-text version used by search, previews, stats and notifications. Old plain entries open as paragraphs and stay plain until you edit them.
- Backups include the formatting (old backups still restore).
- Part 2 (next): fonts, text/highlight colours, manual direction + alignment, quotes/checklists, formatted display in entry view and lists.

## Rich editor — update
- Lists fixed: tapping the list button again removes the list; bulleted and numbered never nest (the other button switches the type); Backspace at the start of an item, or Enter on an empty item, leaves the list.
- New: LTR / RTL buttons (force a paragraph's direction; tap again for automatic), text colour palette (8 colours + default).
- Undo/redo now steps back whole typing bursts (a pause, Enter, paste or a format change ends a step) and the buttons dim when there is nothing to undo/redo.

## Rich editor — part 2
- Font button: Default, Serif, Naskh (Arabic-script book style), Mono, Hand. These are fonts every phone already has, so nothing is downloaded and entries look the same offline and after a restore.
- Highlight button: 6 translucent colours (readable in light and dark themes) + "none".
- Toolbar buttons show the formatting at the caret (font, colour, highlight).
- Entries are only ever shown as 1-line plain previews outside the editor, so no formatted viewer was needed.
