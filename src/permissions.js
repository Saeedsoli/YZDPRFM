/**
 * عطر یزد | تعریف مجوزها و نقش‌ها
 * ────────────────────────────────
 * این فایل تنها منبع حقیقت درباره «چه کارهایی در سیستم وجود دارد»
 * است. اگر مجوز تازه‌ای لازم شد، اول اینجا اضافه می‌شود.
 *
 * قاعده نام‌گذاری: «حوزه.عمل»
 *   orders.view    دیدن فهرست سفارش‌ها
 *   orders.cancel  لغو سفارش
 *
 * چرا عملیات‌محور و نه بخش‌محور؟
 *   چون «انباردار سفارش را ببیند ولی لغو نکند» با روشن/خاموش کردن
 *   کل بخش سفارش‌ها ممکن نیست.
 */

'use strict';

/** حوزه‌ها — فقط برای گروه‌بندی در رابط کاربری */
const GROUPS = [
  { key: 'orders',   label: 'سفارش‌ها' },
  { key: 'products', label: 'محصولات و موجودی' },
  { key: 'reviews',  label: 'نظرات' },
  { key: 'tickets',  label: 'تیکت مرجوعی' },
  { key: 'coupons',  label: 'کدهای تخفیف' },
  { key: 'content',  label: 'مقالات' },
  { key: 'reports',  label: 'گزارش‌ها' },
  { key: 'settings', label: 'تنظیمات فروشگاه' },
  { key: 'staff',    label: 'کارکنان و نقش‌ها' },
  { key: 'system',   label: 'سیستم' }
];

/**
 * فهرست کامل مجوزها.
 *
 * `danger: true` یعنی عملی که برگشت‌ناپذیر است یا اثر مالی دارد —
 * در رابط کاربری با رنگ هشدار نشان داده می‌شود.
 */
const PERMISSIONS = [
  // ── سفارش‌ها ──
  { key: 'orders.view',      group: 'orders',   label: 'مشاهده سفارش‌ها',
    hint: 'فهرست و جزئیات همه سفارش‌ها' },
  { key: 'orders.status',    group: 'orders',   label: 'پیشبرد وضعیت سفارش',
    hint: 'آماده‌سازی ← ارسال ← تحویل' },
  { key: 'orders.cancel',    group: 'orders',   label: 'لغو یا مرجوع کردن سفارش',
    hint: 'موجودی برمی‌گردد و کد تخفیف آزاد می‌شود', danger: true },
  { key: 'orders.invoice',   group: 'orders',   label: 'صدور فاکتور و برچسب پستی',
    hint: 'شامل نام و نشانی مشتری' },
  { key: 'orders.export',    group: 'orders',   label: 'خروجی CSV سفارش‌ها',
    hint: 'شامل نام، شماره و نشانی مشتریان', danger: true },

  // ── محصولات ──
  // این دو مجوز مسیر API اختصاصی ندارند (کاتالوگ عمومی است) و
  // تنها تعیین می‌کنند تب مربوطه در پنل دیده شود یا نه.
  { key: 'products.view',    group: 'products', label: 'مشاهده محصولات و موجودی',
    hint: 'دیدن تب محصولات در پنل' },
  { key: 'products.stock',   group: 'products', label: 'تغییر موجودی' },
  { key: 'products.price',   group: 'products', label: 'تغییر قیمت',
    hint: 'اثر مستقیم روی فروش', danger: true },
  { key: 'products.edit',    group: 'products', label: 'ویرایش مشخصات محصول',
    hint: 'نام، نُت‌ها، خانواده بویایی' },

  // ── نظرات ──
  { key: 'reviews.view',     group: 'reviews',  label: 'مشاهده نظرات' },
  { key: 'reviews.moderate', group: 'reviews',  label: 'تأیید یا رد نظر' },
  { key: 'reviews.reply',    group: 'reviews',  label: 'پاسخ عمومی به نظر' },
  { key: 'reviews.delete',   group: 'reviews',  label: 'حذف نظر', danger: true },
  { key: 'reviews.invite',   group: 'reviews',  label: 'ساخت دعوت‌نامه نظر',
    hint: 'برای مشتریان فروش حضوری که سفارش آنلاین ندارند' },

  // ── تیکت‌ها ──
  { key: 'tickets.view',     group: 'tickets',  label: 'مشاهده تیکت‌های مرجوعی' },
  { key: 'tickets.reply',    group: 'tickets',  label: 'پاسخ به تیکت' },

  // ── کوپن‌ها ──
  { key: 'coupons.view',     group: 'coupons',  label: 'مشاهده کدهای تخفیف' },
  { key: 'coupons.create',   group: 'coupons',  label: 'ساخت کد تخفیف', danger: true },
  { key: 'coupons.toggle',   group: 'coupons',  label: 'فعال یا غیرفعال کردن کد' },
  { key: 'coupons.delete',   group: 'coupons',  label: 'حذف کد تخفیف', danger: true },

  // ── محتوا ──
  { key: 'content.view',     group: 'content',  label: 'مشاهده مقالات',
    hint: 'دیدن تب مقالات در پنل' },
  { key: 'content.write',    group: 'content',  label: 'نوشتن و ویرایش مقاله' },
  { key: 'content.delete',   group: 'content',  label: 'حذف مقاله', danger: true },

  // ── گزارش‌ها ──
  { key: 'reports.sales',    group: 'reports',  label: 'گزارش فروش و درآمد',
    hint: 'مبالغ، سود، مشتریان وفادار', danger: true },
  { key: 'reports.stock',    group: 'reports',  label: 'گزارش موجودی و کالاهای رو به اتمام' },
  { key: 'reports.traffic',  group: 'reports',  label: 'تحلیل بازدید و رفتار مشتری',
    hint: 'قیف خرید، جستجوهای بی‌نتیجه، پربازدیدها' },

  // ── تنظیمات ──
  { key: 'settings.view',    group: 'settings', label: 'مشاهده تنظیمات فروشگاه' },
  { key: 'settings.edit',    group: 'settings', label: 'ویرایش تنظیمات',
    hint: 'اطلاعات حقوقی روی فاکتور', danger: true },

  // ── کارکنان ──
  { key: 'staff.view',       group: 'staff',    label: 'مشاهده فهرست کارکنان' },
  { key: 'staff.manage',     group: 'staff',    label: 'افزودن و ویرایش کارکنان',
    hint: 'ساخت حساب، تغییر نقش، غیرفعال کردن', danger: true },
  { key: 'roles.manage',     group: 'staff',    label: 'تعریف و ویرایش نقش‌ها',
    hint: 'تعیین اینکه هر نقش چه اجازه‌هایی دارد', danger: true },

  // ── سیستم ──
  { key: 'system.logs',      group: 'system',   label: 'مشاهده لاگ سیستم' },
  { key: 'system.backup',    group: 'system',   label: 'پشتیبان‌گیری و دانلود نسخه‌ها',
    hint: 'فایل شامل همه اطلاعات مشتریان است', danger: true },
  { key: 'system.maintenance', group: 'system', label: 'اجرای نگهداشت دستی' }
];

const ALL_KEYS = PERMISSIONS.map(p => p.key);
const KEY_SET = new Set(ALL_KEYS);

/**
 * نقش‌های پیش‌فرض.
 *
 * این‌ها فقط نقطه شروع‌اند — مدیر می‌تواند ویرایششان کند یا نقش
 * تازه بسازد. `builtin: true` یعنی نمی‌شود حذفشان کرد، ولی
 * مجوزهایشان قابل تغییر است.
 */
const DEFAULT_ROLES = [
  {
    key: 'owner',
    name: 'مدیر کل',
    description: 'دسترسی کامل به همه بخش‌ها. تنها نقشی که می‌تواند کارکنان و نقش‌ها را تعریف کند.',
    builtin: true,
    locked: true,               // مجوزهایش قابل تغییر نیست
    permissions: ALL_KEYS
  },
  {
    key: 'support',
    name: 'پشتیبان',
    description: 'پاسخ به مشتری، پیگیری سفارش، رسیدگی به تیکت و نظرات. بدون دسترسی مالی.',
    builtin: true,
    permissions: [
      'orders.view', 'orders.status', 'orders.invoice',
      'products.view',
      'reviews.view', 'reviews.moderate', 'reviews.reply', 'reviews.invite',
      'tickets.view', 'tickets.reply',
      'coupons.view'
    ]
  },
  {
    key: 'warehouse',
    name: 'انباردار',
    description: 'مدیریت موجودی و آماده‌سازی مرسوله. قیمت را نمی‌بیند و تغییر نمی‌دهد.',
    builtin: true,
    permissions: [
      'orders.view', 'orders.status', 'orders.invoice',
      'products.view', 'products.stock',
      'reports.stock'
    ]
  },
  {
    key: 'accountant',
    name: 'حسابدار',
    description: 'گزارش فروش، فاکتورها و خروجی حسابداری. بدون دخالت در عملیات انبار.',
    builtin: true,
    permissions: [
      'orders.view', 'orders.invoice', 'orders.export',
      'products.view',
      'reports.sales', 'reports.stock', 'reports.traffic',
      'coupons.view',
      'settings.view'
    ]
  },
  {
    key: 'editor',
    name: 'محتوانویس',
    description: 'نوشتن مقاله و مدیریت نظرات. بدون دسترسی به سفارش و مالی.',
    builtin: true,
    permissions: [
      'products.view',
      'content.view', 'content.write',
      'reviews.view', 'reviews.moderate', 'reviews.reply', 'reviews.invite',
      'reports.traffic'
    ]
  }
];

/** آیا این کلید مجوز معتبر است؟ */
function isValidPermission(key) {
  return KEY_SET.has(key);
}

/** فهرست مجوزها را پاک می‌کند: تکراری‌ها و کلیدهای ناشناخته حذف می‌شوند */
function sanitizePermissions(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(k => KEY_SET.has(k)))];
}

/** مجوزها را برای نمایش در رابط کاربری گروه‌بندی می‌کند */
function groupedPermissions() {
  return GROUPS.map(g => ({
    ...g,
    items: PERMISSIONS.filter(p => p.group === g.key)
  })).filter(g => g.items.length);
}

module.exports = {
  GROUPS,
  PERMISSIONS,
  ALL_KEYS,
  DEFAULT_ROLES,
  isValidPermission,
  sanitizePermissions,
  groupedPermissions
};
