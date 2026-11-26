// Plugins published in the Zahabi Plugin Store for the demo.
// Each plugin's code defines `handle(event, payload, settings, store)` and returns
// { decision?: 'allow' | 'reject', message?: string, store?: Record<string, unknown> }.

export interface CatalogPlugin {
  key: string;
  name: string;
  description: string;
  developer: string;
  category: string;
  pricingModel: 'free' | 'monthly' | 'one_time' | 'trial';
  pricePiasters: number;
  version: string;
  manifest: {
    permissions: string[];
    hooks: { event: string; mode: 'sync' | 'async' }[];
    settings: { key: string; label: string; type: 'number' | 'boolean'; default: number | boolean }[];
  };
  code: string;
}

export const PLUGIN_CATALOG: CatalogPlugin[] = [
  {
    key: 'loyalty',
    name: 'نقاط الولاء',
    description: 'العميل بياخد نقطة على كل 100 جنيه بيشتريها، والنقط بتتخزن جوه قاعدة المحل.',
    developer: 'ذهبي',
    category: 'الولاء',
    pricingModel: 'free',
    pricePiasters: 0,
    version: '1.0.0',
    manifest: {
      permissions: ['sales.invoices:read', 'customers:read'],
      hooks: [{ event: 'invoice.finalized', mode: 'async' }],
      settings: [{ key: 'egp_per_point', label: 'جنيه لكل نقطة', type: 'number', default: 100 }],
    },
    code: `
function handle(event, payload, settings, store) {
  const who = payload.customer_name || 'عميل نقدي';
  const per = Number(settings.egp_per_point || 100);
  const earned = Math.floor(payload.total_piasters / 100 / per);
  const key = 'points:' + who;
  const now = (store[key] || 0) + earned;
  return { store: { [key]: now }, message: who + ' كسب ' + earned + ' نقطة، والإجمالي ' + now };
}`,
  },
  {
    key: 'big-invoice-guard',
    name: 'حد الفاتورة الكبيرة',
    description: 'بيوقف أي فاتورة فوق حد معيّن لحد ما المدير يراجعها. مثال على إضافة بتشتغل قبل قفل الفاتورة.',
    developer: 'ذهبي',
    category: 'سير العمل',
    pricingModel: 'monthly',
    pricePiasters: 15000,
    version: '1.0.0',
    manifest: {
      permissions: ['sales.invoices:read'],
      hooks: [{ event: 'invoice.before_finalize', mode: 'sync' }],
      settings: [
        { key: 'limit_egp', label: 'الحد بالجنيه', type: 'number', default: 200000 },
        { key: 'blocking', label: 'توقف الفاتورة لو رفضت', type: 'boolean', default: true },
      ],
    },
    code: `
function handle(event, payload, settings, store) {
  const limit = Number(settings.limit_egp || 200000) * 100;
  if (payload.total_piasters > limit) {
    return { decision: 'reject', message: 'الفاتورة فوق الحد (' + (limit / 100).toLocaleString('ar-EG') + ' ج.م)، محتاجة موافقة المدير' };
  }
  return { decision: 'allow' };
}`,
  },
  {
    key: 'whatsapp-receipt',
    name: 'إيصال على واتساب',
    description: 'بيبعت للعميل ملخص الفاتورة على واتساب بعد البيع. في الديمو الرسالة بتتسجل بس ومش بتتبعت.',
    developer: 'شريك معتمد',
    category: 'التسويق وواتساب',
    pricingModel: 'trial',
    pricePiasters: 9900,
    version: '0.9.0',
    manifest: {
      permissions: ['sales.invoices:read', 'customers:read', 'network:graph.facebook.com'],
      hooks: [{ event: 'invoice.finalized', mode: 'async' }],
      settings: [],
    },
    code: `
function handle(event, payload, settings, store) {
  const sent = (store.sent || 0) + 1;
  return { store: { sent: sent }, message: 'إيصال الفاتورة ' + payload.number + ' جاهز يتبعت لـ ' + (payload.customer_name || 'العميل') };
}`,
  },
  {
    key: 'slow-example',
    name: 'إضافة بطيئة (للتجربة)',
    description: 'مثال للمطورين: بتاخد ثانيتين قبل قفل الفاتورة. ذهبي بيوقفها بعد نص ثانية والفاتورة بتكمل عادي.',
    developer: 'مثال للمطورين',
    category: 'أمثلة',
    pricingModel: 'free',
    pricePiasters: 0,
    version: '1.0.0',
    manifest: {
      permissions: ['sales.invoices:read'],
      hooks: [{ event: 'invoice.before_finalize', mode: 'sync' }],
      settings: [{ key: 'blocking', label: 'توقف الفاتورة لو رفضت', type: 'boolean', default: false }],
    },
    code: `
function handle(event, payload, settings, store) {
  const end = Date.now() + 2000;
  while (Date.now() < end) {}
  return { decision: 'reject', message: 'مش المفروض توصل هنا' };
}`,
  },
];
