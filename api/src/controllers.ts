import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException,
  Param, Patch, Post, Put, UnauthorizedException, UnprocessableEntityException, UseGuards,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { Databases } from './db/databases';
import { TENANT_SCHEMA_VERSION } from './db/schema';
import { Claims, PlatformGuard, signPlatformToken, signTenantToken, TenantClaims, TenantDb, TenantGuard } from './auth/auth';
import { PluginRuntime } from './plugins/runtime';

const egp = (piasters: number | string) => Number(piasters) / 100;

// ───────────────────────────── Sign-up, login, tenant switch ─────────────────────────────
@Controller('api/v2')
export class AuthController {
  constructor(private readonly dbs: Databases) {}

  /** TEN-01/02: a new shop gets its own database, cloned from the template. */
  @Post('tenants')
  async signup(@Body() b: { shopName: string; slug: string; ownerName: string; phone: string; password: string }) {
    const slug = String(b.slug ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{2,29}$/.test(slug)) throw new BadRequestException('اسم الرابط: حروف إنجليزي صغيرة وأرقام وشَرطة، من 3 لـ 30');
    if (!b.shopName?.trim() || !b.ownerName?.trim()) throw new BadRequestException('اكتب اسم المحل واسم المالك');
    if (!/^01[0125]\d{8}$/.test(String(b.phone ?? ''))) throw new BadRequestException('رقم موبايل مصري من 11 رقم');
    if (String(b.password ?? '').length < 6) throw new BadRequestException('كلمة السر 6 حروف على الأقل');

    const control = this.dbs.control();
    const dbName = `tenant_${slug.replace(/-/g, '_')}`;
    const exists = await control.query('SELECT 1 FROM tenants WHERE slug = $1', [slug]);
    if (exists.rowCount) throw new ConflictException('الرابط ده محجوز لمحل تاني');

    // User may already exist (e.g. an accountant for several shops, TEN-05).
    let user = (await control.query('SELECT id, name, password_hash FROM users WHERE phone = $1', [b.phone])).rows[0];
    if (user && !(await bcrypt.compare(b.password, user.password_hash))) {
      throw new ConflictException('الرقم ده مسجل قبل كده بكلمة سر تانية');
    }
    const t = (await control.query(
      "INSERT INTO tenants (slug, name, db_name, status) VALUES ($1, $2, $3, 'provisioning') RETURNING id",
      [slug, b.shopName.trim(), dbName],
    )).rows[0];

    const t0 = Date.now();
    try {
      await this.dbs.provisionTenant(dbName);
    } catch (e) {
      await control.query("UPDATE tenants SET status = 'failed' WHERE id = $1", [t.id]);
      throw e;
    }
    const provisionMs = Date.now() - t0;
    await control.query("UPDATE tenants SET status = 'active', schema_version = $2 WHERE id = $1", [t.id, TENANT_SCHEMA_VERSION]);

    const isNewUser = !user;
    if (!user) {
      user = (await control.query(
        'INSERT INTO users (phone, name, password_hash) VALUES ($1, $2, $3) RETURNING id, name',
        [b.phone, b.ownerName.trim(), await bcrypt.hash(b.password, 10)],
      )).rows[0];
    }
    await control.query("INSERT INTO user_tenant_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'owner')", [user.id, t.id]);
    await control.query("INSERT INTO audit_platform (actor, action, detail) VALUES ('signup', 'tenant.provisioned', $1)", [
      { slug, dbName, provisionMs },
    ]);

    return {
      token: signTenantToken({ sub: user.id, tid: t.id, role: 'owner', name: user.name }),
      tenant: { id: t.id, slug, name: b.shopName.trim(), dbName },
      user: { name: user.name },
      // The phone already had an account: the new shop joins it (TEN-05), keeping the old owner name and password.
      existingAccount: !isNewUser,
      provisionMs,
    };
  }

  /** Login returns every shop this user belongs to; the token is for the chosen (or first) one. */
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() b: { phone: string; password: string; tenantId?: string }) {
    const control = this.dbs.control();
    const user = (await control.query('SELECT id, name, password_hash FROM users WHERE phone = $1', [b.phone])).rows[0];
    if (!user || !(await bcrypt.compare(String(b.password ?? ''), user.password_hash))) {
      throw new UnauthorizedException('الرقم أو كلمة السر غلط');
    }
    const tenants = (await control.query(
      `SELECT t.id, t.slug, t.name, m.role FROM user_tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 AND t.status = 'active' ORDER BY t.created_at`,
      [user.id],
    )).rows;
    if (!tenants.length) throw new UnauthorizedException('مفيش محل شغال على الحساب ده');
    const chosen = tenants.find((t) => t.id === b.tenantId) ?? tenants[0];
    return {
      token: signTenantToken({ sub: user.id, tid: chosen.id, role: chosen.role, name: user.name }),
      tenant: chosen,
      tenants,
      user: { name: user.name },
    };
  }

  /** Platform team login (demo credentials from env). The platform never sees shop data (BR-44). */
  @Post('admin/login')
  @HttpCode(200)
  adminLogin(@Body() b: { user: string; password: string }) {
    const u = process.env.PLATFORM_USER ?? 'admin';
    const p = process.env.PLATFORM_PASSWORD ?? 'admin123';
    if (b.user !== u || b.password !== p) throw new UnauthorizedException('بيانات الدخول غلط');
    return { token: signPlatformToken(u) };
  }
}

// ───────────────────────────── Shop: prices, items, POS, invoices ─────────────────────────────
@Controller('api/v2')
@UseGuards(TenantGuard)
export class ShopController {
  constructor(private readonly dbs: Databases, private readonly runtime: PluginRuntime) {}

  @Get('me')
  async me(@Claims() c: TenantClaims, @TenantDb() db: Pool) {
    const rec = await this.dbs.tenantRecord(c.tid);
    const dbName = (await db.query('SELECT current_database() AS d')).rows[0].d;
    return { user: { id: c.sub, name: c.name, role: c.role }, tenant: rec, connectedDatabase: dbName };
  }

  @Get('dashboard')
  async dashboard(@TenantDb() db: Pool) {
    const r = (await db.query(`
      SELECT
        (SELECT count(*) FROM items WHERE status = 'in_stock')::int AS in_stock,
        (SELECT coalesce(sum(weight_mg), 0) FROM items WHERE status = 'in_stock')::bigint AS stock_weight_mg,
        (SELECT count(*) FROM invoices WHERE created_at::date = current_date)::int AS invoices_today,
        (SELECT coalesce(sum(total_piasters), 0) FROM invoices WHERE created_at::date = current_date)::bigint AS sales_today,
        (SELECT count(*) FROM installed_plugins WHERE enabled)::int AS plugins_enabled`)).rows[0];
    return {
      inStock: r.in_stock,
      stockWeightG: Number(r.stock_weight_mg) / 1000,
      invoicesToday: r.invoices_today,
      salesTodayEgp: egp(r.sales_today),
      pluginsEnabled: r.plugins_enabled,
    };
  }

  @Get('gold-prices')
  async prices(@TenantDb() db: Pool) {
    const r = await db.query('SELECT karat, price_per_gram_piasters, updated_at FROM karat_prices ORDER BY karat DESC');
    return r.rows.map((x) => ({ karat: x.karat, pricePerGramEgp: egp(x.price_per_gram_piasters), updatedAt: x.updated_at }));
  }

  @Put('gold-prices/:karat')
  async setPrice(@TenantDb() db: Pool, @Claims() c: TenantClaims, @Param('karat') karat: string, @Body() b: { pricePerGramEgp: number }) {
    const piasters = Math.round(Number(b.pricePerGramEgp) * 100);
    if (!(piasters > 0)) throw new BadRequestException('السعر لازم يكون أكبر من صفر');
    return this.dbs.withTx(db, async (tx) => {
      const before = (await tx.query('SELECT * FROM karat_prices WHERE karat = $1 FOR UPDATE', [Number(karat)])).rows[0];
      if (!before) throw new NotFoundException('العيار ده مش موجود');
      const after = (await tx.query(
        'UPDATE karat_prices SET price_per_gram_piasters = $2, updated_at = now() WHERE karat = $1 RETURNING *',
        [Number(karat), piasters],
      )).rows[0];
      await tx.query("INSERT INTO audit_log (actor, action, entity, before, after) VALUES ($1, 'update', 'karat_price', $2, $3)", [c.name, before, after]);
      await tx.query("INSERT INTO outbox (event, payload) VALUES ('gold_price.updated', $1)", [{ karat: Number(karat), price_per_gram_piasters: piasters }]);
      return { karat: after.karat, pricePerGramEgp: egp(after.price_per_gram_piasters) };
    });
  }

  @Get('items')
  async items(@TenantDb() db: Pool) {
    const r = await db.query(`
      SELECT i.*, k.price_per_gram_piasters FROM items i JOIN karat_prices k ON k.karat = i.karat ORDER BY i.id DESC`);
    return r.rows.map((x) => {
      const gold = Math.round((x.weight_mg * Number(x.price_per_gram_piasters)) / 1000);
      const making = Math.round((x.weight_mg * Number(x.making_piasters_per_g)) / 1000);
      return {
        id: x.id, sku: x.sku, name: x.name, karat: x.karat, weightG: x.weight_mg / 1000,
        makingPerGEgp: egp(x.making_piasters_per_g), status: x.status, priceNowEgp: egp(gold + making),
      };
    });
  }

  @Post('items')
  async addItem(@TenantDb() db: Pool, @Claims() c: TenantClaims, @Body() b: { name: string; karat: number; weightG: number; makingPerGEgp: number }) {
    const weightMg = Math.round(Number(b.weightG) * 1000);
    if (!b.name?.trim()) throw new BadRequestException('اكتب اسم القطعة');
    if (![24, 21, 18].includes(Number(b.karat))) throw new BadRequestException('العيار 24 أو 21 أو 18');
    if (!(weightMg > 0)) throw new BadRequestException('الوزن لازم يكون أكبر من صفر');
    return this.dbs.withTx(db, async (tx) => {
      const n = (await tx.query('SELECT count(*)::int AS n FROM items')).rows[0].n + 1;
      const sku = `ZH-${String(n).padStart(5, '0')}`;
      const row = (await tx.query(
        'INSERT INTO items (sku, name, karat, weight_mg, making_piasters_per_g, branch_id) VALUES ($1,$2,$3,$4,$5,1) RETURNING *',
        [sku, b.name.trim(), Number(b.karat), weightMg, Math.round(Number(b.makingPerGEgp || 0) * 100)],
      )).rows[0];
      await tx.query("INSERT INTO audit_log (actor, action, entity, after) VALUES ($1, 'create', 'item', $2)", [c.name, row]);
      await tx.query("INSERT INTO outbox (event, payload) VALUES ('item.created', $1)", [{ id: row.id, sku, karat: row.karat, weight_mg: weightMg }]);
      return { id: row.id, sku };
    });
  }

  /** POS sale: price at today's gold rate, run sync plugin hooks, then save everything in one transaction. */
  @Post('pos/sell')
  async sell(@TenantDb() db: Pool, @Claims() c: TenantClaims, @Body() b: { itemIds: number[]; customerName?: string }) {
    const ids = (b.itemIds ?? []).map(Number).filter((x) => x > 0);
    if (!ids.length) throw new BadRequestException('اختار قطعة واحدة على الأقل');

    const priced = async (q: Pool | import('pg').PoolClient, lock: boolean) => {
      const r = await q.query(
        `SELECT i.id, i.sku, i.name, i.karat, i.weight_mg, i.making_piasters_per_g, i.status, k.price_per_gram_piasters
         FROM items i JOIN karat_prices k ON k.karat = i.karat WHERE i.id = ANY($1) ${lock ? 'FOR UPDATE OF i' : ''}`,
        [ids],
      );
      if (r.rowCount !== ids.length) throw new NotFoundException('في قطعة مش موجودة');
      const sold = r.rows.find((x) => x.status !== 'in_stock');
      if (sold) throw new ConflictException(`القطعة ${sold.sku} اتباعت قبل كده`);
      return r.rows.map((x) => {
        const gold = Math.round((x.weight_mg * Number(x.price_per_gram_piasters)) / 1000);
        const making = Math.round((x.weight_mg * Number(x.making_piasters_per_g)) / 1000);
        return { ...x, gold, making, total: gold + making };
      });
    };

    const preview = await priced(db, false);
    const total = preview.reduce((s, l) => s + l.total, 0);
    const customer = b.customerName?.trim() || null;

    const gate = await this.runtime.beforeFinalize(db, { total_piasters: total, lines: preview.length, customer_name: customer });
    if (gate.blocked) throw new UnprocessableEntityException({ message: gate.message ?? 'إضافة رفضت الفاتورة', plugin: gate.by });

    return this.dbs.withTx(db, async (tx) => {
      const lines = await priced(tx, true);
      const sum = lines.reduce((s, l) => s + l.total, 0);
      const inv = (await tx.query(
        "INSERT INTO invoices (number, status, total_piasters, customer_name, created_by) VALUES ('pending', 'finalized', $1, $2, $3) RETURNING id",
        [sum, customer, c.name],
      )).rows[0];
      const number = `INV-${String(inv.id).padStart(6, '0')}`;
      await tx.query('UPDATE invoices SET number = $2 WHERE id = $1', [inv.id, number]);
      for (const l of lines) {
        await tx.query(
          'INSERT INTO invoice_lines (invoice_id, item_id, karat, weight_mg, gold_piasters, making_piasters, line_total_piasters) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [inv.id, l.id, l.karat, l.weight_mg, l.gold, l.making, l.total],
        );
        await tx.query("UPDATE items SET status = 'sold' WHERE id = $1", [l.id]);
      }
      const payload = { id: inv.id, number, total_piasters: sum, customer_name: customer, lines: lines.length };
      await tx.query("INSERT INTO outbox (event, payload) VALUES ('invoice.finalized', $1)", [payload]);
      await tx.query("INSERT INTO audit_log (actor, action, entity, after) VALUES ($1, 'finalize', 'invoice', $2)", [c.name, payload]);
      return { id: inv.id, number, totalEgp: egp(sum) };
    });
  }

  @Get('invoices')
  async invoices(@TenantDb() db: Pool) {
    const r = await db.query(`
      SELECT v.*, (SELECT count(*) FROM invoice_lines l WHERE l.invoice_id = v.id)::int AS lines
      FROM invoices v ORDER BY v.id DESC LIMIT 100`);
    return r.rows.map((x) => ({
      id: x.id, number: x.number, totalEgp: egp(x.total_piasters), customerName: x.customer_name,
      lines: x.lines, createdBy: x.created_by, createdAt: x.created_at,
    }));
  }

  @Get('audit-log')
  async audit(@TenantDb() db: Pool) {
    return (await db.query('SELECT id, actor, action, entity, at FROM audit_log ORDER BY id DESC LIMIT 50')).rows;
  }
}

// ───────────────────────────── Plugin store and installed plugins ─────────────────────────────
@Controller('api/v2')
@UseGuards(TenantGuard)
export class PluginsController {
  constructor(private readonly dbs: Databases) {}

  @Get('store/plugins')
  async store(@TenantDb() db: Pool) {
    const cat = await this.dbs.control().query('SELECT key, name, description, developer, category, pricing_model, price_piasters, version, manifest FROM plugins ORDER BY key');
    const inst = await db.query('SELECT plugin_key, enabled, settings, installed_at FROM installed_plugins');
    const byKey = new Map(inst.rows.map((r) => [r.plugin_key, r]));
    return cat.rows.map((p) => ({
      key: p.key, name: p.name, description: p.description, developer: p.developer, category: p.category,
      pricingModel: p.pricing_model, priceEgp: egp(p.price_piasters), version: p.version,
      permissions: p.manifest.permissions, hooks: p.manifest.hooks, settingsSchema: p.manifest.settings,
      installed: byKey.has(p.key) ? byKey.get(p.key) : null,
    }));
  }

  /** PLG-04: install only with the exact permissions the owner saw and approved. */
  @Post('plugins/installed')
  async install(@TenantDb() db: Pool, @Claims() c: TenantClaims, @Body() b: { key: string; approvedPermissions: string[] }) {
    if (c.role !== 'owner') throw new UnauthorizedException('المالك بس اللي يقدر يثبّت إضافات');
    const p = (await this.dbs.control().query('SELECT key, version, manifest FROM plugins WHERE key = $1', [b.key])).rows[0];
    if (!p) throw new NotFoundException('الإضافة مش موجودة في المتجر');
    const need = [...p.manifest.permissions].sort().join(',');
    const got = [...(b.approvedPermissions ?? [])].sort().join(',');
    if (need !== got) throw new BadRequestException('لازم توافق على كل صلاحيات الإضافة');
    const defaults = Object.fromEntries((p.manifest.settings ?? []).map((s: { key: string; default: unknown }) => [s.key, s.default]));
    await db.query(
      `INSERT INTO installed_plugins (plugin_key, version, settings, approved_permissions) VALUES ($1, $2, $3, $4)
       ON CONFLICT (plugin_key) DO UPDATE SET enabled = true, version = EXCLUDED.version, approved_permissions = EXCLUDED.approved_permissions`,
      [p.key, p.version, defaults, JSON.stringify(b.approvedPermissions)],
    );
    await db.query("INSERT INTO audit_log (actor, action, entity, after) VALUES ($1, 'install', 'plugin', $2)", [c.name, { key: p.key, version: p.version }]);
    return { ok: true };
  }

  @Patch('plugins/installed/:key')
  async update(@TenantDb() db: Pool, @Param('key') key: string, @Body() b: { enabled?: boolean; settings?: Record<string, unknown> }) {
    const r = await db.query(
      `UPDATE installed_plugins SET enabled = coalesce($2, enabled), settings = settings || coalesce($3, '{}'::jsonb)
       WHERE plugin_key = $1 RETURNING plugin_key, enabled, settings`,
      [key, b.enabled ?? null, b.settings ? JSON.stringify(b.settings) : null],
    );
    if (!r.rowCount) throw new NotFoundException('الإضافة مش متثبتة');
    return r.rows[0];
  }

  /** Uninstall keeps the plugin's data (30 days in production, PLG-14). */
  @Delete('plugins/installed/:key')
  async uninstall(@TenantDb() db: Pool, @Param('key') key: string) {
    await db.query('DELETE FROM installed_plugins WHERE plugin_key = $1', [key]);
    return { ok: true };
  }

  @Get('plugins/logs')
  async logs(@TenantDb() db: Pool) {
    return (await db.query('SELECT * FROM plugin_event_log ORDER BY id DESC LIMIT 100')).rows;
  }

  @Get('plugins/:key/data')
  async data(@TenantDb() db: Pool, @Param('key') key: string) {
    return (await db.query('SELECT k, v FROM plugin_data WHERE plugin_key = $1 ORDER BY k', [key])).rows;
  }
}

// ───────────────────────────── Platform console (HQ) ─────────────────────────────
@Controller('api/v2/admin')
@UseGuards(PlatformGuard)
export class AdminController {
  constructor(private readonly dbs: Databases) {}

  /** Screen 60 "PlatformDatabases": where each shop's DB is, its size and schema version. No shop data. */
  @Get('tenants')
  async tenants() {
    const r = await this.dbs.control().query(`
      SELECT t.id, t.slug, t.name, t.db_name, t.status, t.schema_version, t.created_at,
             CASE WHEN EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = t.db_name)
                  THEN pg_database_size(t.db_name) END AS size_bytes,
             (SELECT count(*) FROM user_tenant_memberships m WHERE m.tenant_id = t.id)::int AS users
      FROM tenants t ORDER BY t.created_at DESC`);
    return r.rows.map((x) => ({ ...x, sizeMb: x.size_bytes ? Math.round(Number(x.size_bytes) / 1024 / 102.4) / 10 : null }));
  }

  @Get('activity')
  async activity() {
    return (await this.dbs.control().query('SELECT * FROM audit_platform ORDER BY id DESC LIMIT 50')).rows;
  }
}
