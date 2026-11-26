// Schemas for the two kinds of database in Zahabi.
// Control DB: one, shared. Tenant DB: one per shop, cloned from a template.

export const CONTROL_SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  db_name       text UNIQUE NOT NULL,
  status        text NOT NULL DEFAULT 'provisioning',
  schema_version int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text UNIQUE NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_tenant_memberships (
  user_id   uuid NOT NULL REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  role      text NOT NULL,
  PRIMARY KEY (user_id, tenant_id)
);
CREATE TABLE IF NOT EXISTS plugins (
  key            text PRIMARY KEY,
  name           text NOT NULL,
  description    text NOT NULL,
  developer      text NOT NULL,
  category       text NOT NULL,
  pricing_model  text NOT NULL,          -- free | monthly | one_time | trial
  price_piasters bigint NOT NULL DEFAULT 0,
  version        text NOT NULL,
  manifest       jsonb NOT NULL,
  code           text NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_platform (
  id     bigserial PRIMARY KEY,
  actor  text NOT NULL,
  action text NOT NULL,
  detail jsonb,
  at     timestamptz NOT NULL DEFAULT now()
);
`;

// Tenant DB schema. Business tables carry no tenant_id: isolation is physical.
export const TENANT_SCHEMA_VERSION = 1;
export const TENANT_SCHEMA = `
CREATE TABLE branches (
  id   serial PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE karat_prices (
  karat                  int PRIMARY KEY,
  price_per_gram_piasters bigint NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE items (
  id                     serial PRIMARY KEY,
  sku                    text UNIQUE NOT NULL,
  name                   text NOT NULL,
  karat                  int NOT NULL REFERENCES karat_prices(karat),
  weight_mg              int NOT NULL CHECK (weight_mg > 0),
  making_piasters_per_g  bigint NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'in_stock',
  branch_id              int NOT NULL REFERENCES branches(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invoices (
  id             serial PRIMARY KEY,
  number         text UNIQUE NOT NULL,
  status         text NOT NULL,
  total_piasters bigint NOT NULL,
  customer_name  text,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invoice_lines (
  id                  serial PRIMARY KEY,
  invoice_id          int NOT NULL REFERENCES invoices(id),
  item_id             int NOT NULL REFERENCES items(id),
  karat               int NOT NULL,
  weight_mg           int NOT NULL,
  gold_piasters       bigint NOT NULL,
  making_piasters     bigint NOT NULL,
  line_total_piasters bigint NOT NULL
);
CREATE TABLE installed_plugins (
  id                   serial PRIMARY KEY,
  plugin_key           text UNIQUE NOT NULL,
  version              text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  settings             jsonb NOT NULL DEFAULT '{}',
  approved_permissions jsonb NOT NULL,
  installed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plugin_data (
  plugin_key text NOT NULL,
  k          text NOT NULL,
  v          jsonb NOT NULL,
  PRIMARY KEY (plugin_key, k)
);
CREATE TABLE plugin_event_log (
  id          bigserial PRIMARY KEY,
  plugin_key  text NOT NULL,
  event       text NOT NULL,
  mode        text NOT NULL,
  result      text NOT NULL,
  message     text,
  duration_ms int NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox (
  id           bigserial PRIMARY KEY,
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE TABLE audit_log (
  id     bigserial PRIMARY KEY,
  actor  text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  before jsonb,
  after  jsonb,
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE meta (k text PRIMARY KEY, v text NOT NULL);

-- Seed: default branch and karats 24 / 21 / 18 (TEN-02). Prices are sample values in piasters per gram.
INSERT INTO branches (name) VALUES ('الفرع الرئيسي');
INSERT INTO karat_prices (karat, price_per_gram_piasters) VALUES (24, 520000), (21, 455000), (18, 390000);
INSERT INTO meta (k, v) VALUES ('schema_version', '${TENANT_SCHEMA_VERSION}');
`;
