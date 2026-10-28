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
