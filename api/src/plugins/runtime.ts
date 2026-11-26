import { Injectable } from '@nestjs/common';
import vm from 'node:vm';
import { Pool, PoolClient } from 'pg';
import { Databases } from '../db/databases';

// Limits from the blueprint (NFR-23): sync hooks get at most 500 ms, async hooks 30 s.
export const SYNC_TIMEOUT_MS = 500;
export const ASYNC_TIMEOUT_MS = 30_000;

export interface PluginResult {
  decision?: 'allow' | 'reject';
  message?: string;
  store?: Record<string, unknown>;
}

interface Installed {
  plugin_key: string;
  settings: Record<string, unknown>;
  code: string;
  hooks: { event: string; mode: 'sync' | 'async' }[];
}

/**
 * Runs plugin code in a separate V8 context with a hard time limit.
 * Demo note: node:vm is NOT a security boundary. Production uses isolated-vm
 * (separate isolates with memory limits) in its own service, as in the blueprint.
 * Plugins never get a DB handle: they receive JSON copies and return changes.
 */
@Injectable()
export class PluginRuntime {
  constructor(private readonly dbs: Databases) {}

  run(code: string, event: string, payload: unknown, settings: unknown, store: unknown, timeoutMs: number): PluginResult {
    const ctx = vm.createContext(Object.create(null));
    const input = JSON.stringify({ event, payload, settings, store });
    const script = new vm.Script(
      `${code}\n;JSON.stringify((function(i){ i = JSON.parse(i); return handle(i.event, i.payload, i.settings, i.store) || {}; })(__input))`,
    );
    ctx.__input = input;
    const out = script.runInContext(ctx, { timeout: timeoutMs });
    return JSON.parse(String(out)) as PluginResult;
  }

  /** Installed + enabled plugins of this tenant that listen to `event` in `mode`. */
  async listeners(tenantPool: Pool, event: string, mode: 'sync' | 'async'): Promise<Installed[]> {
    const inst = await tenantPool.query<{ plugin_key: string; settings: Record<string, unknown> }>(
      'SELECT plugin_key, settings FROM installed_plugins WHERE enabled = true',
    );
    if (!inst.rowCount) return [];
    const keys = inst.rows.map((r) => r.plugin_key);
    const cat = await this.dbs
      .control()
      .query<{ key: string; code: string; manifest: { hooks: { event: string; mode: 'sync' | 'async' }[] } }>(
        'SELECT key, code, manifest FROM plugins WHERE key = ANY($1)',
        [keys],
      );
    const byKey = new Map(cat.rows.map((r) => [r.key, r]));
    return inst.rows
      .map((r) => {
        const p = byKey.get(r.plugin_key);
        return p ? { plugin_key: r.plugin_key, settings: r.settings, code: p.code, hooks: p.manifest.hooks } : null;
      })
      .filter((p): p is Installed => !!p && p.hooks.some((h) => h.event === event && h.mode === mode));
  }

  async loadStore(db: Pool | PoolClient, key: string): Promise<Record<string, unknown>> {
    const r = await db.query<{ k: string; v: unknown }>('SELECT k, v FROM plugin_data WHERE plugin_key = $1', [key]);
    return Object.fromEntries(r.rows.map((x) => [x.k, x.v]));
  }

  async saveStore(db: Pool | PoolClient, key: string, store: Record<string, unknown>) {
    for (const [k, v] of Object.entries(store)) {
      await db.query(
        `INSERT INTO plugin_data (plugin_key, k, v) VALUES ($1, $2, $3)
         ON CONFLICT (plugin_key, k) DO UPDATE SET v = EXCLUDED.v`,
        [key, k, JSON.stringify(v)],
      );
    }
  }

  async log(db: Pool | PoolClient, key: string, event: string, mode: string, result: string, message: string | null, ms: number) {
    await db.query(
      'INSERT INTO plugin_event_log (plugin_key, event, mode, result, message, duration_ms) VALUES ($1,$2,$3,$4,$5,$6)',
      [key, event, mode, result, message, ms],
    );
  }

  /**
   * Sync hook before an invoice closes (BR-47). A plugin that is late or crashes never blocks the sale
   * (fail-open). A reject only blocks when the owner set the plugin's `blocking` setting.
   */
  async beforeFinalize(tenantPool: Pool, payload: unknown): Promise<{ blocked: boolean; message?: string; by?: string }> {
    for (const p of await this.listeners(tenantPool, 'invoice.before_finalize', 'sync')) {
      const t0 = Date.now();
      try {
        const store = await this.loadStore(tenantPool, p.plugin_key);
        const res = this.run(p.code, 'invoice.before_finalize', payload, p.settings, store, SYNC_TIMEOUT_MS);
        const ms = Date.now() - t0;
        if (res.decision === 'reject') {
          const blocking = p.settings.blocking !== false;
          await this.log(tenantPool, p.plugin_key, 'invoice.before_finalize', 'sync', blocking ? 'rejected' : 'rejected_ignored', res.message ?? null, ms);
          if (blocking) return { blocked: true, message: res.message, by: p.plugin_key };
        } else {
          await this.log(tenantPool, p.plugin_key, 'invoice.before_finalize', 'sync', 'allowed', res.message ?? null, ms);
        }
      } catch (e) {
        const ms = Date.now() - t0;
        const timedOut = /timed out/i.test(String((e as Error).message));
        await this.log(
          tenantPool,
          p.plugin_key,
          'invoice.before_finalize',
          'sync',
          timedOut ? 'timeout_fail_open' : 'error_fail_open',
          timedOut ? `اتأخرت أكتر من ${SYNC_TIMEOUT_MS} مللي ثانية، والفاتورة كمّلت` : String((e as Error).message),
          ms,
        );
      }
    }
    return { blocked: false };
  }
}
