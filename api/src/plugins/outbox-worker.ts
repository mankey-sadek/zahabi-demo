import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Databases } from '../db/databases';
import { ASYNC_TIMEOUT_MS, PluginRuntime } from './runtime';

/**
 * Delivers events written to each tenant's outbox to the plugins that listen to them.
 * The event row is written in the same transaction as the sale, so nothing is lost if the
 * server stops. Production publishes the outbox to NATS JetStream; the demo polls directly.
 */
@Injectable()
export class OutboxWorker implements OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly dbs: Databases, private readonly runtime: PluginRuntime) {}

  start(intervalMs = 1000) {
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const t of await this.dbs.activeTenants()) {
        await this.drainTenant(t.id).catch((e) => console.error(`outbox ${t.slug}:`, e.message));
      }
    } finally {
      this.busy = false;
    }
  }

  async drainTenant(tenantId: string) {
    const pool = await this.dbs.tenant(tenantId);
    await this.dbs.withTx(pool, async (c) => {
      const rows = await c.query<{ id: string; event: string; payload: unknown }>(
        'SELECT id, event, payload FROM outbox WHERE processed_at IS NULL ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED',
      );
      for (const ev of rows.rows) {
        for (const p of await this.runtime.listeners(pool, ev.event, 'async')) {
          const t0 = Date.now();
          try {
            const store = await this.runtime.loadStore(c, p.plugin_key);
            const res = this.runtime.run(p.code, ev.event, ev.payload, p.settings, store, ASYNC_TIMEOUT_MS);
            if (res.store) await this.runtime.saveStore(c, p.plugin_key, res.store);
            await this.runtime.log(c, p.plugin_key, ev.event, 'async', 'ok', res.message ?? null, Date.now() - t0);
          } catch (e) {
            await this.runtime.log(c, p.plugin_key, ev.event, 'async', 'error', String((e as Error).message), Date.now() - t0);
          }
        }
        await c.query('UPDATE outbox SET processed_at = now() WHERE id = $1', [ev.id]);
      }
    });
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
