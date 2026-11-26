import { useState } from 'react';
import { api, Session } from './api';

type Mode = 'signup' | 'login' | 'platform';
type ShopChoice = { id: string; slug: string; name: string; role: string };
type LoginReply = { token: string; tenant: ShopChoice; tenants: ShopChoice[]; user: { name: string } };

export function Auth({ onSession }: { onSession: (s: Session, note?: string) => void }) {
  const [mode, setMode] = useState<Mode>('signup');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // A phone can own several shops (TEN-05): after the password check, the user picks one.
  const [choices, setChoices] = useState<ShopChoice[] | null>(null);
  const [f, setF] = useState({ shopName: '', slug: '', ownerName: '', phone: '', password: '', user: 'admin' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF({ ...f, [k]: e.target.value });
    setChoices(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        const r = await api<{ token: string; tenant: { name: string; dbName: string }; user: { name: string }; existingAccount: boolean; provisionMs: number }>('/tenants', {
          body: { shopName: f.shopName, slug: f.slug, ownerName: f.ownerName, phone: f.phone, password: f.password },
        });
        const made = `اتعملت قاعدة بيانات المحل ${r.tenant.dbName} في ${r.provisionMs.toLocaleString('ar-EG')} مللي ثانية`;
        onSession(
          { kind: 'shop', token: r.token, tenantName: r.tenant.name, userName: r.user.name },
          r.existingAccount ? `${made}. الرقم ده عليه حساب قبل كده، فالمحل اتضاف لنفس الحساب، وهتختار المحل وانت داخل.` : made,
        );
      } else if (mode === 'login') {
        const r = await api<LoginReply>('/auth/login', { body: { phone: f.phone, password: f.password } });
        if (r.tenants.length > 1) setChoices(r.tenants);
        else onSession({ kind: 'shop', token: r.token, tenantName: r.tenant.name, userName: r.user.name });
      } else {
        const r = await api<{ token: string }>('/admin/login', { body: { user: f.user, password: f.password } });
        onSession({ kind: 'platform', token: r.token });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pick(t: ShopChoice) {
    setErr('');
    setBusy(true);
    try {
      const r = await api<LoginReply>('/auth/login', { body: { phone: f.phone, password: f.password, tenantId: t.id } });
      onSession({ kind: 'shop', token: r.token, tenantName: r.tenant.name, userName: r.user.name });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setChoices(null);
    setErr('');
  }

  return (
    <div className="auth stack">
      <div className="brand">
        <div className="logo">ذ</div>
        <div>
          <h1>ذهبي</h1>
          <div className="muted">ديمو شغال: قاعدة بيانات لكل محل، ومتجر إضافات</div>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'stretch' }}>
        <form className="card stack" style={{ flex: '1 1 380px' }} onSubmit={submit}>
          <div className="row">
            <button type="button" className={`btn small ${mode === 'signup' ? '' : 'ghost'}`} onClick={() => switchMode('signup')}>اشتراك محل جديد</button>
            <button type="button" className={`btn small ${mode === 'login' ? '' : 'ghost'}`} onClick={() => switchMode('login')}>دخول</button>
            <button type="button" className={`btn small ${mode === 'platform' ? '' : 'ghost'}`} onClick={() => switchMode('platform')}>فريق المنصة</button>
          </div>

          {mode === 'signup' && (
            <>
              <div className="row">
                <label className="field">اسم المحل<input required value={f.shopName} onChange={set('shopName')} placeholder="مجوهرات النور" /></label>
                <label className="field">الرابط (إنجليزي)<input required dir="ltr" value={f.slug} onChange={set('slug')} placeholder="alnoor" /></label>
              </div>
              <label className="field">اسم المالك<input required value={f.ownerName} onChange={set('ownerName')} /></label>
            </>
          )}
          {mode !== 'platform' ? (
            <label className="field">الموبايل<input required dir="ltr" value={f.phone} onChange={set('phone')} placeholder="01012345678" /></label>
          ) : (
            <label className="field">اسم المستخدم<input required dir="ltr" value={f.user} onChange={set('user')} /></label>
          )}
          <label className="field">كلمة السر<input required type="password" dir="ltr" value={f.password} onChange={set('password')} /></label>
          {mode === 'platform' && <div className="muted">في الديمو: admin / admin123</div>}
          {choices && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="muted">الرقم ده عليه {choices.length === 2 ? 'محلين' : `${choices.length.toLocaleString('ar-EG')} محلات`}. تدخل على أنهي محل؟</div>
              {choices.map((t) => (
                <button key={t.id} type="button" className="btn ghost" disabled={busy} onClick={() => pick(t)}>{t.name} ({t.slug})</button>
              ))}
            </div>
          )}
          {err && <div className="error">{err}</div>}
          {!choices && <button className="btn" disabled={busy}>{busy ? 'لحظة…' : mode === 'signup' ? 'اشترك واعمل قاعدة المحل' : 'دخول'}</button>}
        </form>

        <div className="card stack" style={{ flex: '1 1 300px' }}>
          <h3>تجرب إيه في الديمو</h3>
          <ol className="muted" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.9, fontSize: 14 }}>
            <li>اشترك بمحلين مختلفين، وكل محل هيتعمل له قاعدة بيانات لوحده.</li>
            <li>ضيف قطع في المخزون وبيع فاتورة من نقطة البيع.</li>
            <li>ثبّت «نقاط الولاء» من المتجر، وبيع تاني، وشوف النقط.</li>
            <li>ثبّت «حد الفاتورة الكبيرة» وقلّل الحد، والفاتورة الكبيرة هتتوقف.</li>
            <li>ثبّت «الإضافة البطيئة»، والفاتورة هتكمل برضه بعد نص ثانية.</li>
            <li>ادخل كفريق المنصة وشوف قواعد المحلات من غير ما تشوف بياناتها.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
