import { useCallback, useEffect, useState } from 'react';
import { api, grams, money, Session, when } from './api';

type Page = 'home' | 'inventory' | 'pos' | 'invoices' | 'prices' | 'store' | 'logs';
type ShopSession = Extract<Session, { kind: 'shop' }>;

const PAGES: { id: Page; label: string }[] = [
  { id: 'home', label: 'الرئيسية' },
  { id: 'pos', label: 'نقطة البيع' },
  { id: 'inventory', label: 'المخزون' },
  { id: 'invoices', label: 'الفواتير' },
  { id: 'prices', label: 'أسعار الذهب' },
  { id: 'store', label: 'متجر الإضافات' },
  { id: 'logs', label: 'سجل الإضافات' },
];

function useApi<T>(s: ShopSession, path: string) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => {
    api<T>(path, { token: s.token }).then(setData).catch((e) => setErr(e.message));
  }, [s.token, path]);
  useEffect(reload, [reload]);
  return { data, err, reload };
}

export function Shop({ s, note, onLogout }: { s: ShopSession; note?: string; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('home');
  const me = useApi<{ user: { name: string; role: string }; tenant: { name: string; slug: string }; connectedDatabase: string }>(s, '/me');
  return (
    <div className="shell">
      <nav className="side">
        <div className="shop">
          <b>{me.data?.tenant.name ?? s.tenantName}</b>
          <span className="muted" style={{ color: '#9fb6bb' }}>{me.data?.user.name}</span>
        </div>
        {PAGES.map((p) => (
          <button key={p.id} className={page === p.id ? 'on' : ''} onClick={() => setPage(p.id)}>{p.label}</button>
        ))}
        <div className="bottom">
          <button onClick={onLogout}>خروج</button>
        </div>
      </nav>
      <main className="main">
        {note && <div className="success">{note}</div>}
        {me.data && (
          <div className="muted">
            متوصّل بقاعدة: <span className="db-chip">{me.data.connectedDatabase}</span>
          </div>
        )}
        {page === 'home' && <Home s={s} />}
        {page === 'inventory' && <Inventory s={s} />}
        {page === 'pos' && <Pos s={s} />}
        {page === 'invoices' && <Invoices s={s} />}
        {page === 'prices' && <Prices s={s} />}
        {page === 'store' && <Store s={s} />}
        {page === 'logs' && <Logs s={s} />}
      </main>
    </div>
  );
}

function Home({ s }: { s: ShopSession }) {
  const d = useApi<{ inStock: number; stockWeightG: number; invoicesToday: number; salesTodayEgp: number; pluginsEnabled: number }>(s, '/dashboard');
  const pts = useApi<{ k: string; v: number }[]>(s, '/plugins/loyalty/data');
  if (!d.data) return <div className="muted">بيحمّل…</div>;
  return (
    <div className="stack">
      <h2>الرئيسية</h2>
      <div className="grid">
        <div className="card stat"><span className="muted">مبيعات النهارده</span><b>{money(d.data.salesTodayEgp)}</b></div>
        <div className="card stat"><span className="muted">فواتير النهارده</span><b>{d.data.invoicesToday.toLocaleString('ar-EG')}</b></div>
        <div className="card stat"><span className="muted">قطع في المخزون</span><b>{d.data.inStock.toLocaleString('ar-EG')} · {grams(d.data.stockWeightG)}</b></div>
        <div className="card stat"><span className="muted">إضافات شغالة</span><b>{d.data.pluginsEnabled.toLocaleString('ar-EG')}</b></div>
      </div>
      {!!pts.data?.length && (
        <div className="card stack">
          <h3>نقاط الولاء (من إضافة «نقاط الولاء»)</h3>
          <table>
            <thead><tr><th>العميل</th><th>النقط</th></tr></thead>
            <tbody>{pts.data.map((p) => <tr key={p.k}><td>{p.k.replace('points:', '')}</td><td className="num">{Number(p.v).toLocaleString('ar-EG')}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Item = { id: number; sku: string; name: string; karat: number; weightG: number; makingPerGEgp: number; status: string; priceNowEgp: number };

function Inventory({ s }: { s: ShopSession }) {
  const items = useApi<Item[]>(s, '/items');
  const [f, setF] = useState({ name: '', karat: '21', weightG: '', makingPerGEgp: '100' });
  const [err, setErr] = useState('');
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await api('/items', { token: s.token, body: { name: f.name, karat: Number(f.karat), weightG: Number(f.weightG), makingPerGEgp: Number(f.makingPerGEgp) } });
      setF({ ...f, name: '', weightG: '' });
      items.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div className="stack">
      <h2>المخزون</h2>
      <form className="card row" onSubmit={add}>
        <label className="field">اسم القطعة<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="خاتم، سلسلة…" /></label>
        <label className="field">العيار<select value={f.karat} onChange={(e) => setF({ ...f, karat: e.target.value })}><option>24</option><option>21</option><option>18</option></select></label>
        <label className="field">الوزن (جم)<input required dir="ltr" inputMode="decimal" value={f.weightG} onChange={(e) => setF({ ...f, weightG: e.target.value })} /></label>
        <label className="field">المصنعية للجرام (ج.م)<input dir="ltr" inputMode="decimal" value={f.makingPerGEgp} onChange={(e) => setF({ ...f, makingPerGEgp: e.target.value })} /></label>
        <button className="btn">إضافة قطعة</button>
        {err && <div className="error" style={{ flexBasis: '100%' }}>{err}</div>}
      </form>
      <div className="card">
        <table>
          <thead><tr><th>الكود</th><th>القطعة</th><th>العيار</th><th>الوزن</th><th>السعر النهارده</th><th>الحالة</th></tr></thead>
          <tbody>
            {items.data?.map((i) => (
              <tr key={i.id}>
                <td className="num">{i.sku}</td><td>{i.name}</td><td>{i.karat}</td><td className="num">{grams(i.weightG)}</td>
                <td className="num">{money(i.priceNowEgp)}</td>
                <td>{i.status === 'in_stock' ? <span className="tag ok">في المخزون</span> : <span className="tag">اتباعت</span>}</td>
              </tr>
            ))}
            {items.data?.length === 0 && <tr><td colSpan={6} className="muted">لسه مفيش قطع. ضيف أول قطعة من فوق.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pos({ s }: { s: ShopSession }) {
  const items = useApi<Item[]>(s, '/items');
  const [picked, setPicked] = useState<number[]>([]);
  const [customer, setCustomer] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const stock = items.data?.filter((i) => i.status === 'in_stock') ?? [];
  const total = stock.filter((i) => picked.includes(i.id)).reduce((t, i) => t + i.priceNowEgp, 0);

  async function sell() {
    setBusy(true);
    setMsg(null);
    const t0 = performance.now();
    try {
      const r = await api<{ number: string; totalEgp: number }>('/pos/sell', { token: s.token, body: { itemIds: picked, customerName: customer } });
      const ms = Math.round(performance.now() - t0);
      setMsg({ ok: true, text: `الفاتورة ${r.number} اتقفلت بـ ${money(r.totalEgp)} في ${ms.toLocaleString('ar-EG')} مللي ثانية` });
      setPicked([]);
      items.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h2>نقطة البيع</h2>
      <div className="card stack">
        {stock.length === 0 && <div className="muted">مفيش قطع في المخزون. ضيف من صفحة المخزون.</div>}
        {stock.map((i) => (
          <label key={i.id} className="pick">
            <input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, i.id] : picked.filter((x) => x !== i.id))} />
            <span style={{ flex: 1 }}>{i.name} · عيار {i.karat} · {grams(i.weightG)}</span>
            <span className="num">{money(i.priceNowEgp)}</span>
          </label>
        ))}
      </div>
      <div className="card row">
        <label className="field">اسم العميل (اختياري)<input value={customer} onChange={(e) => setCustomer(e.target.value)} /></label>
        <div className="stat" style={{ flex: '1 1 160px' }}><span className="muted">الإجمالي</span><b>{money(total)}</b></div>
        <button className="btn" disabled={!picked.length || busy} onClick={sell}>{busy ? 'بيقفل الفاتورة…' : 'اقفل الفاتورة'}</button>
      </div>
      {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
    </div>
  );
}

function Invoices({ s }: { s: ShopSession }) {
  const inv = useApi<{ id: number; number: string; totalEgp: number; customerName: string | null; lines: number; createdBy: string; createdAt: string }[]>(s, '/invoices');
  return (
    <div className="stack">
      <h2>الفواتير</h2>
      <div className="card">
        <table>
          <thead><tr><th>الرقم</th><th>العميل</th><th>القطع</th><th>الإجمالي</th><th>البائع</th><th>الوقت</th></tr></thead>
          <tbody>
            {inv.data?.map((v) => (
              <tr key={v.id}><td className="num">{v.number}</td><td>{v.customerName ?? 'عميل نقدي'}</td><td>{v.lines}</td><td className="num">{money(v.totalEgp)}</td><td>{v.createdBy}</td><td>{when(v.createdAt)}</td></tr>
            ))}
            {inv.data?.length === 0 && <tr><td colSpan={6} className="muted">لسه مفيش فواتير.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Prices({ s }: { s: ShopSession }) {
  const p = useApi<{ karat: number; pricePerGramEgp: number; updatedAt: string }[]>(s, '/gold-prices');
  const [edit, setEdit] = useState<Record<number, string>>({});
  async function save(karat: number) {
    await api(`/gold-prices/${karat}`, { token: s.token, method: 'PUT', body: { pricePerGramEgp: Number(edit[karat]) } });
    setEdit({ ...edit, [karat]: '' });
    p.reload();
  }
  return (
    <div className="stack">
      <h2>أسعار الذهب</h2>
      <div className="card">
        <table>
          <thead><tr><th>العيار</th><th>سعر الجرام</th><th>آخر تحديث</th><th>سعر جديد</th><th /></tr></thead>
          <tbody>
            {p.data?.map((k) => (
              <tr key={k.karat}>
                <td>عيار {k.karat}</td><td className="num">{money(k.pricePerGramEgp)}</td><td>{when(k.updatedAt)}</td>
                <td><input dir="ltr" style={{ width: 120, padding: 6, border: '1px solid #cfd4dc', borderRadius: 6 }} value={edit[k.karat] ?? ''} onChange={(e) => setEdit({ ...edit, [k.karat]: e.target.value })} /></td>
                <td><button className="btn small" disabled={!edit[k.karat]} onClick={() => save(k.karat)}>حفظ</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type StorePlugin = {
  key: string; name: string; description: string; developer: string; category: string; pricingModel: string; priceEgp: number; version: string;
  permissions: string[]; hooks: { event: string; mode: string }[]; settingsSchema: { key: string; label: string; type: string; default: unknown }[];
  installed: { enabled: boolean; settings: Record<string, unknown> } | null;
};

const PRICE_LABEL: Record<string, (p: number) => string> = {
  free: () => 'مجانية',
  monthly: (p) => `${money(p)} في الشهر`,
  one_time: (p) => `${money(p)} مرة واحدة`,
  trial: (p) => `تجربة 14 يوم ثم ${money(p)} في الشهر`,
};

function Store({ s }: { s: ShopSession }) {
  const st = useApi<StorePlugin[]>(s, '/store/plugins');
  const [consent, setConsent] = useState<StorePlugin | null>(null);
  const [err, setErr] = useState('');

  async function install(p: StorePlugin) {
    setErr('');
    try {
      await api('/plugins/installed', { token: s.token, body: { key: p.key, approvedPermissions: p.permissions } });
      setConsent(null);
      st.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function patch(p: StorePlugin, body: unknown) {
    await api(`/plugins/installed/${p.key}`, { token: s.token, method: 'PATCH', body });
    st.reload();
  }
  async function remove(p: StorePlugin) {
    await api(`/plugins/installed/${p.key}`, { token: s.token, method: 'DELETE' });
    st.reload();
  }

  return (
    <div className="stack">
      <h2>متجر الإضافات</h2>
      {err && <div className="error">{err}</div>}
      <div className="grid">
        {st.data?.map((p) => (
          <div key={p.key} className="card plugin">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{p.name}</h3>
              {p.installed ? <span className={`tag ${p.installed.enabled ? 'ok' : 'warn'}`}>{p.installed.enabled ? 'شغالة' : 'متوقفة'}</span> : <span className="tag gold">{PRICE_LABEL[p.pricingModel](p.priceEgp)}</span>}
            </div>
            <div className="muted">{p.developer} · {p.category} · v{p.version}</div>
            <div style={{ fontSize: 14 }}>{p.description}</div>
            <div className="muted">بتشتغل على: {p.hooks.map((h) => `${h.event} (${h.mode === 'sync' ? 'قبل' : 'بعد'})`).join('، ')}</div>
            {p.installed && p.settingsSchema.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                {p.settingsSchema.map((f) => f.type === 'boolean' ? (
                  <label key={f.key} className="pick"><input type="checkbox" checked={Boolean(p.installed!.settings[f.key])} onChange={(e) => patch(p, { settings: { [f.key]: e.target.checked } })} />{f.label}</label>
                ) : (
                  <label key={f.key} className="field">{f.label}
                    <input dir="ltr" defaultValue={String(p.installed!.settings[f.key] ?? f.default)} onBlur={(e) => patch(p, { settings: { [f.key]: Number(e.target.value) } })} />
                  </label>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 'auto' }}>
              {!p.installed && <button className="btn small" onClick={() => setConsent(p)}>تثبيت</button>}
              {p.installed && <button className="btn small ghost" onClick={() => patch(p, { enabled: !p.installed!.enabled })}>{p.installed.enabled ? 'إيقاف' : 'تشغيل'}</button>}
              {p.installed && <button className="btn small ghost" onClick={() => remove(p)}>إزالة</button>}
            </div>
          </div>
        ))}
      </div>

      {consent && (
        <div className="modal-bg" onClick={() => setConsent(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>تثبيت «{consent.name}»</h3>
            <div className="muted">الإضافة دي هتقدر توصل للحاجات دي بس في محلك. لازم توافق عليها كلها:</div>
            <div className="stack" style={{ gap: 6 }}>{consent.permissions.map((x) => <span key={x} className="perm">{x}</span>)}</div>
            <div className="muted">الإضافة مش بتلمس قاعدة البيانات مباشرة، وتقدر توقفها في أي وقت.</div>
            <div className="row">
              <button className="btn" onClick={() => install(consent)}>موافق، ثبّت</button>
              <button className="btn ghost" onClick={() => setConsent(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const RESULT: Record<string, [string, string]> = {
  ok: ['اشتغلت', 'ok'],
  allowed: ['وافقت', 'ok'],
  rejected: ['رفضت ووقفت الفاتورة', 'bad'],
  rejected_ignored: ['رفضت (مش موقِفة)', 'warn'],
  timeout_fail_open: ['اتأخرت، والفاتورة كمّلت', 'warn'],
  error_fail_open: ['وقعت، والفاتورة كمّلت', 'warn'],
  error: ['خطأ', 'bad'],
};

function Logs({ s }: { s: ShopSession }) {
  const l = useApi<{ id: number; plugin_key: string; event: string; mode: string; result: string; message: string | null; duration_ms: number; at: string }[]>(s, '/plugins/logs');
  useEffect(() => {
    const t = setInterval(l.reload, 2000);
    return () => clearInterval(t);
  }, [l.reload]);
  return (
    <div className="stack">
      <h2>سجل الإضافات</h2>
      <div className="muted">كل مرة إضافة اشتغلت عند المحل: الحدث، والنتيجة، والمدة (PLG-12). بيتحدث كل ثانيتين.</div>
      <div className="card">
        <table>
          <thead><tr><th>الوقت</th><th>الإضافة</th><th>الحدث</th><th>النتيجة</th><th>المدة</th><th>الرسالة</th></tr></thead>
          <tbody>
            {l.data?.map((x) => (
              <tr key={x.id}>
                <td>{when(x.at)}</td><td>{x.plugin_key}</td><td dir="ltr" style={{ textAlign: 'right' }}>{x.event}</td>
                <td><span className={`tag ${RESULT[x.result]?.[1] ?? ''}`}>{RESULT[x.result]?.[0] ?? x.result}</span></td>
                <td className="num">{x.duration_ms.toLocaleString('ar-EG')} مللي</td><td>{x.message}</td>
              </tr>
            ))}
            {l.data?.length === 0 && <tr><td colSpan={6} className="muted">لسه مفيش. ثبّت إضافة وبيع فاتورة.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
