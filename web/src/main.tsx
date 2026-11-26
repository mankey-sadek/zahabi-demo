import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, loadSession, saveSession, Session, when } from './api';
import { Auth } from './Auth';
import { Shop } from './Shop';
import './styles.css';

type TenantRow = { id: string; slug: string; name: string; db_name: string; status: string; schema_version: number; created_at: string; sizeMb: number | null; users: number };

function Platform({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<TenantRow[]>('/admin/tenants', { token }).then(setRows).catch((e) => setErr(e.message));
  }, [token]);
  return (
    <div className="auth stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="brand"><div className="logo">ذ</div><div><h1>لوحة المنصة</h1><div className="muted">قواعد بيانات المحلات (شاشة 60)</div></div></div>
        <button className="btn ghost" onClick={onLogout}>خروج</button>
      </div>
      <div className="muted">فريق المنصة بيشوف مكان كل قاعدة وحجمها وإصدارها بس، ومايقدرش يفتح بيانات أي محل (BR-44).</div>
      {err && <div className="error">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>المحل</th><th>القاعدة</th><th>الحالة</th><th>إصدار الجداول</th><th>الحجم</th><th>المستخدمين</th><th>اتعمل</th></tr></thead>
          <tbody>
            {rows?.map((t) => (
              <tr key={t.id}>
                <td>{t.name}<div className="muted" dir="ltr" style={{ textAlign: 'right' }}>{t.slug}</div></td>
                <td><span className="db-chip">{t.db_name}</span></td>
                <td><span className={`tag ${t.status === 'active' ? 'ok' : 'warn'}`}>{t.status === 'active' ? 'شغال' : t.status}</span></td>
                <td>v{t.schema_version}</td>
                <td className="num">{t.sizeMb?.toLocaleString('ar-EG')} ميجا</td>
                <td>{t.users}</td>
                <td>{when(t.created_at)}</td>
              </tr>
            ))}
            {rows?.length === 0 && <tr><td colSpan={7} className="muted">لسه مفيش محلات.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function App() {
  const [s, setS] = useState<Session | null>(loadSession());
  const [note, setNote] = useState<string | undefined>();
  const logout = () => { saveSession(null); setS(null); setNote(undefined); };
  if (!s) return <Auth onSession={(x, n) => { saveSession(x); setS(x); setNote(n); }} />;
  if (s.kind === 'platform') return <Platform token={s.token} onLogout={logout} />;
  return <Shop s={s} note={note} onLogout={logout} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
