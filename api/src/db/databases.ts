import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { CONTROL_SCHEMA, TENANT_SCHEMA, TENANT_SCHEMA_VERSION } from './schema';
import { PLUGIN_CATALOG } from '../plugins/catalog';

const TEMPLATE_DB = 'zahabi_tenant_template';

function cfg() {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
  };
}

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  db_name: string;
  status: string;
}

/**
 * Owns every database connection in the app.
 * - control(): the single Control DB.
 * - tenant(id): a pool bound to that shop's own database. Business code never opens
 *   a connection itself; it only gets the pool for the tenant in its request (TEN-04).
 */
@Injectable()
export class Databases implements OnModuleDestroy {
  private controlPool: Pool;
  private tenantPools = new Map<string, Pool>();
  // Tenant registry cache (Redis with a 5 minute TTL in production).
  private registry = new Map<string, { rec: TenantRecord; at: number }>();
  private readonly controlDb = process.env.CONTROL_DB ?? 'zahabi_control';

  async init() {
    await this.ensureDatabase(this.controlDb);
    this.controlPool = new Pool({ ...cfg(), database: this.controlDb, max: 10 });
    await this.controlPool.query(CONTROL_SCHEMA);
    await this.seedCatalog();
    await this.ensureTemplate();
  }

  control(): Pool {
    return this.controlPool;
  }

  async tenantRecord(tenantId: string): Promise<TenantRecord | null> {
    const hit = this.registry.get(tenantId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.rec;
    const r = await this.controlPool.query<TenantRecord>(
      'SELECT id, slug, name, db_name, status FROM tenants WHERE id = $1',
      [tenantId],
    );
    if (!r.rowCount) return null;
    this.registry.set(tenantId, { rec: r.rows[0], at: Date.now() });
    return r.rows[0];
  }

  async tenant(tenantId: string): Promise<Pool> {
    const existing = this.tenantPools.get(tenantId);
    if (existing) return existing;
    const rec = await this.tenantRecord(tenantId);
    if (!rec || rec.status !== 'active') throw new Error('tenant not active');
    const pool = new Pool({ ...cfg(), database: rec.db_name, max: 5, idleTimeoutMillis: 60_000 });
    this.tenantPools.set(tenantId, pool);
    return pool;
  }

  async activeTenants(): Promise<TenantRecord[]> {
    const r = await this.controlPool.query<TenantRecord>(
      "SELECT id, slug, name, db_name, status FROM tenants WHERE status = 'active'",
    );
    return r.rows;
  }

  /** Provision a new shop database by cloning the template (target < 60 s, NFR-22). */
  async provisionTenant(dbName: string) {
    const admin = new Pool({ ...cfg(), database: 'postgres', max: 1 });
    try {
      await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB}"`);
    } finally {
      await admin.end();
    }
  }

  async withTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  private async ensureDatabase(name: string) {
    const admin = new Pool({ ...cfg(), database: 'postgres', max: 1 });
    try {
      const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (!r.rowCount) await admin.query(`CREATE DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
  }

  private async ensureTemplate() {
    const admin = new Pool({ ...cfg(), database: 'postgres', max: 1 });
    try {
      const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEMPLATE_DB]);
      if (r.rowCount) return;
      await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
    } finally {
      await admin.end();
    }
    // Build the template once, then close the pool: Postgres can only clone a template nobody is connected to.
    const t = new Pool({ ...cfg(), database: TEMPLATE_DB, max: 1 });
    try {
      await t.query(TENANT_SCHEMA);
    } finally {
      await t.end();
    }
    console.log(`template database ready (schema v${TENANT_SCHEMA_VERSION})`);
  }

  private async seedCatalog() {
    for (const p of PLUGIN_CATALOG) {
      await this.controlPool.query(
        `INSERT INTO plugins (key, name, description, developer, category, pricing_model, price_piasters, version, manifest, code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (key) DO UPDATE SET name=$2, description=$3, developer=$4, category=$5, pricing_model=$6,
           price_piasters=$7, version=$8, manifest=$9, code=$10`,
        [p.key, p.name, p.description, p.developer, p.category, p.pricingModel, p.pricePiasters, p.version, p.manifest, p.code],
      );
    }
  }

  async onModuleDestroy() {
    for (const p of this.tenantPools.values()) await p.end();
    await this.controlPool?.end();
  }
}
