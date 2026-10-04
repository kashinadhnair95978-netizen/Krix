-- ============================================================================
-- Krix — P0 billing integrity migration
-- Date: 2026-09-30
-- Phase: P0 launch blockers
--
-- SAFETY: additive and idempotent only. No column is dropped, no data is
-- rewritten, no RLS policy is changed, and existing rows are untouched.
-- Every statement is safe to run more than once.
--
-- Apply with either:
--   psql "$DATABASE_URL" -f supabase/migrations/202609300001_p0_billing_integrity.sql
-- or paste into the Supabase SQL editor.
--
-- WHY EACH INDEX IS NEEDED
--   1. subscriptions(recurring_id) — every provider webhook resolves ownership
--      by recurring_id alone. The existing UNIQUE(user_id, recurring_id) index
--      is keyed on user_id first, so those lookups were sequential scans.
--   2. payments(external_payment_id) — webhook delivery is at-least-once, and
--      both the webhook and the Razorpay confirm route de-duplicate on this id
--      so a provider retry cannot double-count revenue.
--   3. subscriptions(user_id, created_at DESC) — GET /api/subscription and the
--      settings page both read "this user's most recent subscription".
--
-- A UNIQUE index on payments(external_payment_id) is deliberately NOT created
-- here: it would fail on any table that already holds duplicate provider ids,
-- and de-duplicating existing revenue rows is not a P0 change to make silently.
-- The application-level de-duplication check already prevents new duplicates.
-- ============================================================================

-- 1. Webhook ownership lookups.
CREATE INDEX IF NOT EXISTS idx_subscriptions_recurring_id
  ON subscriptions (recurring_id)
  WHERE recurring_id IS NOT NULL;

-- 2. Payment ledger de-duplication on webhook retry.
CREATE INDEX IF NOT EXISTS idx_payments_external_payment_id
  ON payments (external_payment_id)
  WHERE external_payment_id IS NOT NULL;

-- 3. "Most recent subscription for this user" reads.
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_created
  ON subscriptions (user_id, created_at DESC);
