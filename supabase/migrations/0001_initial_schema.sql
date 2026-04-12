-- =============================================================================
-- R10 Supabase Migration — Initial Schema
-- =============================================================================
-- Maps 12 domain entity types (one per KEYS entry in LocalPortfolioRepository)
-- to individual Postgres tables.
--
-- Design conventions:
--   • user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
--     on every table — RLS isolates data per user
--   • TEXT primary keys — domain uses non-UUID string IDs (e.g. 'provider-web-demo',
--     'default', Psagot numeric account IDs). Forcing UUID would require domain changes.
--   • NUMERIC(20,8) for all financial figures — avoids floating-point precision errors
--   • TIMESTAMPTZ for all datetime fields — ISO 8601 strings serialized by Supabase JS client
--   • Cross-table FKs reference simple 'id' TEXT columns (not composite user-scoped FKs).
--     This is safe: RLS enforces user isolation on both sides; composite FKs would require
--     matching composite PKs across all tables (unacceptable schema complexity). Application
--     INSERT order always creates parent rows before child rows.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. providers  (LocalPortfolioRepository key: providers.v1)
-- Domain type: Provider
-- Root entity — no foreign key dependencies.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE providers (
  id          TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, user_id)
);

CREATE INDEX idx_providers_user_id ON providers (user_id);

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY providers_user_isolation ON providers
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE providers IS 'Domain type: Provider. One row per financial data provider (e.g. Psagot broker).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. accounts  (LocalPortfolioRepository key: accounts.v1)
-- Domain type: Account
-- Composite PK (user_id, provider_id, id) because account IDs like 'default'
-- and Psagot numeric IDs are only unique within a provider, and providers are
-- user-scoped. 'default' can legitimately exist per provider.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE accounts (
  id                  TEXT        NOT NULL,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id         TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  is_name_customized  BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, provider_id, id)
);

CREATE INDEX idx_accounts_user_provider ON accounts (user_id, provider_id);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounts_user_isolation ON accounts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE accounts IS 'Domain type: Account. Provider-scoped account (e.g. psagot-joint, psagot-ira). Composite PK because account IDs are only unique within a provider.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. provider_integrations  (LocalPortfolioRepository key: provider-integrations.v1)
-- Domain type: ProviderIntegration
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_integrations (
  id                    TEXT        NOT NULL,
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id           TEXT        NOT NULL,
  kind                  TEXT        NOT NULL CHECK (kind IN ('document', 'api', 'manual')),
  data_domain           TEXT        NOT NULL CHECK (data_domain IN (
                          'cash_transactions', 'trades', 'holdings',
                          'billing_cycles', 'credit_card_statements',
                          'account_balances', 'other'
                        )),
  communication_method  TEXT        NOT NULL CHECK (communication_method IN (
                          'document_csv', 'document_pdf', 'api_pull',
                          'api_webhook', 'manual_entry'
                        )),
  sync_mode             TEXT        NOT NULL CHECK (sync_mode IN ('manual', 'scheduled', 'realtime')),
  direction             TEXT        NOT NULL CHECK (direction IN ('ingest', 'export', 'bidirectional')),
  adapter_key           TEXT        NOT NULL,
  mapping_profile_id    TEXT,        -- nullable; no FK (would create circular ref with mapping_profiles)
  is_enabled            BOOLEAN     NOT NULL DEFAULT true,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, user_id)
);

CREATE INDEX idx_provider_integrations_user_provider ON provider_integrations (user_id, provider_id);

ALTER TABLE provider_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_integrations_user_isolation ON provider_integrations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE provider_integrations IS 'Domain type: ProviderIntegration. One channel per provider (e.g. CSV upload, API pull). mapping_profile_id is nullable to avoid circular FK with provider_mapping_profiles.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. provider_mapping_profiles  (LocalPortfolioRepository key: provider-mapping-profiles.v1)
-- Domain type: ProviderMappingProfile
-- JSONB used for fieldMappings, valueMappings, parsingRules (nested/dynamic shapes).
-- TEXT[] used for requiredCanonicalFields and optionalCanonicalFields (flat string arrays).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_mapping_profiles (
  id                          TEXT        NOT NULL,
  user_id                     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id                 TEXT        NOT NULL,
  provider_integration_id     TEXT        NOT NULL,
  name                        TEXT        NOT NULL,
  version                     INT         NOT NULL DEFAULT 1,
  is_active                   BOOLEAN     NOT NULL DEFAULT false,
  input_format                TEXT        NOT NULL CHECK (input_format IN ('csv', 'pdf', 'json')),
  header_fingerprint          TEXT,
  field_mappings              JSONB       NOT NULL,     -- Record<string, string>
  required_canonical_fields   TEXT[]      NOT NULL,     -- string[]
  optional_canonical_fields   TEXT[],                   -- string[] | undefined
  value_mappings              JSONB,                    -- Record<string, Record<string, string>> | undefined
  parsing_rules               JSONB,                    -- Record<string, string | number | boolean> | undefined
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, user_id)
);

-- Composite index supports getActiveMappingProfile (filter by integration + is_active)
-- and listMappingProfiles (filter by integration, order by version).
CREATE INDEX idx_mapping_profiles_user_integration_active
  ON provider_mapping_profiles (user_id, provider_integration_id, is_active);

ALTER TABLE provider_mapping_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_mapping_profiles_user_isolation ON provider_mapping_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE provider_mapping_profiles IS 'Domain type: ProviderMappingProfile. CSV/PDF/JSON field mapping rules per integration. field_mappings, value_mappings, parsing_rules stored as JSONB due to dynamic key shapes.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. provider_account_mappings  (LocalPortfolioRepository key: provider-account-mappings.v1)
-- Domain type: ProviderAccountMapping
-- Unique constraint on (user_id, provider_id, provider_account_ref) enables
-- Supabase upsert with onConflict targeting these columns.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_account_mappings (
  id                    TEXT        NOT NULL,
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id           TEXT        NOT NULL,
  provider_account_ref  TEXT        NOT NULL,
  account_id            TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, provider_id, provider_account_ref)  -- supports upsert by composite key
);

CREATE INDEX idx_account_mappings_user_provider ON provider_account_mappings (user_id, provider_id);

ALTER TABLE provider_account_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_account_mappings_user_isolation ON provider_account_mappings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE provider_account_mappings IS 'Domain type: ProviderAccountMapping. Maps provider-side account references to internal Account IDs.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. provider_symbol_mappings  (LocalPortfolioRepository key: provider-symbol-mappings.v1)
-- Domain type: ProviderSymbolMapping
-- Unique constraint on (user_id, provider_id, provider_symbol) enables
-- Supabase upsert with onConflict targeting these columns.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_symbol_mappings (
  id                TEXT        NOT NULL,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id       TEXT        NOT NULL,
  provider_symbol   TEXT        NOT NULL,
  symbol            TEXT        NOT NULL,
  display_symbol    TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, user_id),
  UNIQUE (user_id, provider_id, provider_symbol)  -- supports upsert by composite key
);

CREATE INDEX idx_symbol_mappings_user_provider_symbol
  ON provider_symbol_mappings (user_id, provider_id, provider_symbol);

ALTER TABLE provider_symbol_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_symbol_mappings_user_isolation ON provider_symbol_mappings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE provider_symbol_mappings IS 'Domain type: ProviderSymbolMapping. Maps provider-side security symbols to canonical display symbols.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. portfolio_import_runs  (LocalPortfolioRepository key: portfolio-import-runs.v1)
-- Domain type: PortfolioImportRun
-- account_id is nullable (domain type has accountId?: string).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE portfolio_import_runs (
  id                        TEXT        NOT NULL,
  user_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id               TEXT        NOT NULL,
  provider_integration_id   TEXT        NOT NULL,
  account_id                TEXT,                   -- nullable (not all runs are account-scoped)
  source_name               TEXT        NOT NULL,
  status                    TEXT        NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed')),
  started_at                TIMESTAMPTZ NOT NULL,
  finished_at               TIMESTAMPTZ,
  imported_count            INT         NOT NULL DEFAULT 0,
  skipped_count             INT         NOT NULL DEFAULT 0,
  error_count               INT         NOT NULL DEFAULT 0,
  is_undoable               BOOLEAN     NOT NULL DEFAULT false,
  undone_at                 TIMESTAMPTZ,
  error_message             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, user_id)
);

-- Supports getLastSuccessfulImportRun (filter by integration + status, order by started_at)
CREATE INDEX idx_import_runs_user_integration_status
  ON portfolio_import_runs (user_id, provider_integration_id, status);
-- Supports listImportRunsByProvider
CREATE INDEX idx_import_runs_user_provider
  ON portfolio_import_runs (user_id, provider_id);

ALTER TABLE portfolio_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY portfolio_import_runs_user_isolation ON portfolio_import_runs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE portfolio_import_runs IS 'Domain type: PortfolioImportRun. Lifecycle record for each import operation (CSV upload or API sync).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. raw_import_rows  (LocalPortfolioRepository key: portfolio-raw-rows.v1)
-- Domain type: RawImportRow
-- Append-only — no updated_at. row_payload stored as TEXT (opaque raw CSV content).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE raw_import_rows (
  id                        TEXT        NOT NULL,
  user_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_run_id             TEXT        NOT NULL,  -- FK enforced below
  provider_id               TEXT        NOT NULL,
  provider_integration_id   TEXT        NOT NULL,
  row_number                INT         NOT NULL,
  row_payload               TEXT        NOT NULL,   -- raw CSV row string; not JSONB (opaque content)
  row_hash                  TEXT        NOT NULL,
  is_valid                  BOOLEAN     NOT NULL,
  error_code                TEXT,
  error_message             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, user_id)
);

-- All reads are by import_run_id (listRawRowsByImportRun)
CREATE INDEX idx_raw_rows_user_run ON raw_import_rows (user_id, import_run_id);

ALTER TABLE raw_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_import_rows_user_isolation ON raw_import_rows
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE raw_import_rows IS 'Domain type: RawImportRow. Append-only audit log of every raw row from every import. Includes invalid/duplicate rows for diagnostics.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. trade_transactions  (LocalPortfolioRepository key: portfolio-trades.v1)
-- Domain type: TradeTransaction
-- Soft-delete: deleted_at is set instead of physical deletion.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE trade_transactions (
  id                        TEXT            NOT NULL,
  user_id                   UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id               TEXT            NOT NULL,
  provider_integration_id   TEXT            NOT NULL,
  import_run_id             TEXT,                         -- nullable (manual trades have no run)
  account_id                TEXT            NOT NULL,
  symbol                    TEXT            NOT NULL,
  display_symbol            TEXT            NOT NULL,
  external_trade_id         TEXT,
  side                      TEXT            NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity                  NUMERIC(20, 8)  NOT NULL,
  price                     NUMERIC(20, 8)  NOT NULL,
  fees                      NUMERIC(20, 8)  NOT NULL DEFAULT 0,
  currency                  TEXT            NOT NULL,     -- CurrencyCode: open string union ('ILS'|'USD'|...)
  trade_at                  TIMESTAMPTZ     NOT NULL,
  note                      TEXT,
  created_at                TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,                  -- soft delete

  PRIMARY KEY (id, user_id)
);

CREATE INDEX idx_trades_user_provider         ON trade_transactions (user_id, provider_id);
CREATE INDEX idx_trades_user_account_symbol   ON trade_transactions (user_id, account_id, symbol);
CREATE INDEX idx_trades_user_run              ON trade_transactions (user_id, import_run_id);
CREATE INDEX idx_trades_user_integration      ON trade_transactions (user_id, provider_integration_id);

ALTER TABLE trade_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY trade_transactions_user_isolation ON trade_transactions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE trade_transactions IS 'Domain type: TradeTransaction. Individual buy/sell events. Soft-deleted (deleted_at) rather than physically removed.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. provider_holding_records  (LocalPortfolioRepository key: portfolio-holding-records.v1)
-- Domain type: ProviderHoldingRecord (alias: HoldingLot)
-- Each row = one purchase lot (not an aggregate snapshot).
-- action_date stored as TEXT (ISO date string) to avoid timezone coercion from DATE casting.
-- account_id is NOT NULL — the migrateAccountId transform (on-read in local repo) sets
-- missing values to 'default' before INSERT during the localStorage→Supabase migration.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_holding_records (
  id                        TEXT            NOT NULL,
  user_id                   UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id               TEXT            NOT NULL,
  provider_integration_id   TEXT            NOT NULL,
  import_run_id             TEXT,
  account_id                TEXT            NOT NULL,  -- NOT NULL: migrateAccountId applied at migration time
  security_id               TEXT            NOT NULL,
  security_name             TEXT            NOT NULL,
  action_type               TEXT            NOT NULL,
  quantity                  NUMERIC(20, 8)  NOT NULL,
  cost_basis                NUMERIC(20, 8)  NOT NULL,
  currency                  TEXT            NOT NULL,
  action_date               TEXT            NOT NULL,  -- ISO date string (not TIMESTAMPTZ — avoids TZ issues)
  current_price             NUMERIC(20, 8),            -- nullable; presence indicates CSV-sourced price snapshot
  created_at                TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,               -- soft delete (used by undo and re-import merge)

  PRIMARY KEY (id, user_id)
);

CREATE INDEX idx_holding_records_user_provider        ON provider_holding_records (user_id, provider_id);
CREATE INDEX idx_holding_records_user_account_provider ON provider_holding_records (user_id, account_id, provider_id);
CREATE INDEX idx_holding_records_user_run             ON provider_holding_records (user_id, import_run_id);
CREATE INDEX idx_holding_records_user_security        ON provider_holding_records (user_id, security_id);  -- getProvenanceForSecurity

ALTER TABLE provider_holding_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_holding_records_user_isolation ON provider_holding_records
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE provider_holding_records IS 'Domain type: ProviderHoldingRecord (alias: HoldingLot). One row per purchase lot (not aggregate). Soft-deleted for undo and re-import merge. account_id is NOT NULL: migrateAccountId transform applied during localStorage→Supabase migration.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. position_lots  (LocalPortfolioRepository key: portfolio-lots.v1)
-- Domain type: PositionLot
-- Derived from trade_transactions by TotalHoldingsStateBuilder (FIFO matching).
-- buy_trade_id references trade_transactions.id.
-- replaceLots() replaces the entire user's lot set — see method contracts doc.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE position_lots (
  id              TEXT            NOT NULL,
  user_id         UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id     TEXT            NOT NULL,
  account_id      TEXT            NOT NULL,
  symbol          TEXT            NOT NULL,
  buy_trade_id    TEXT            NOT NULL,   -- references trade_transactions(id)
  original_qty    NUMERIC(20, 8)  NOT NULL,
  open_qty        NUMERIC(20, 8)  NOT NULL,
  cost_per_unit   NUMERIC(20, 8)  NOT NULL,
  fees_allocated  NUMERIC(20, 8)  NOT NULL DEFAULT 0,
  opened_at       TIMESTAMPTZ     NOT NULL,
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,               -- nullable; set when lot is fully closed

  PRIMARY KEY (id, user_id)
);

-- Only read access pattern: listLotsByAccountSymbol
CREATE INDEX idx_position_lots_user_account_symbol ON position_lots (user_id, account_id, symbol);

ALTER TABLE position_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY position_lots_user_isolation ON position_lots
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE position_lots IS 'Domain type: PositionLot. FIFO-matched open lots derived from trade_transactions. Entire user set is replaced atomically by replaceLots() — see SUPABASE_METHOD_CONTRACTS.md for atomicity notes.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. ticker_mappings  (LocalPortfolioRepository key: ticker-mappings.v1)
-- Domain type: TickerMapping
-- Composite PK (user_id, security_id) — the domain type has no 'id' field;
-- securityId is the domain-level unique key, scoped per user.
-- ticker is nullable (null = resolution failed or not yet attempted).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ticker_mappings (
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  security_id   TEXT        NOT NULL,
  security_name TEXT        NOT NULL,
  ticker        TEXT,                    -- nullable: null means resolution failed or pending
  exchange      TEXT,
  resolved_at   TIMESTAMPTZ NOT NULL,
  resolved_by   TEXT        NOT NULL CHECK (resolved_by IN ('auto', 'manual', 'static-table')),

  PRIMARY KEY (user_id, security_id)    -- composite PK; no surrogate id column
);

-- PK already covers (user_id, security_id) lookups — no additional index needed.

ALTER TABLE ticker_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticker_mappings_user_isolation ON ticker_mappings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE ticker_mappings IS 'Domain type: TickerMapping. Maps security IDs to market ticker symbols. Composite PK (user_id, security_id) — domain type has no id field. ticker is nullable when resolution has failed.';
