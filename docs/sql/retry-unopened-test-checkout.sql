-- TEST ONLY: operator confirmed that checkout never opened and no payment was attempted.
-- First run inspect-voting-checkout.sql; copy the exact stuck purchase UUID below.
-- Never use this for an uncertain live payment. Do not alter snapshots or references.
BEGIN;
DO $retry_unopened_test_checkout$
DECLARE
  target_id text := '54878103-39ed-4843-9aff-2ef9f12dc8f9';
  purchase vote_purchases%ROWTYPE;
BEGIN
  IF target_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
    RAISE EXCEPTION 'Set target_id to the exact test purchase UUID from inspect-voting-checkout.sql';
  END IF;
  SELECT * INTO purchase FROM vote_purchases WHERE id=target_id::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
  IF purchase.provider<>'flutterwave' OR purchase.provider_mode IS DISTINCT FROM 'test' THEN RAISE EXCEPTION 'Only Flutterwave test purchases can use this reset'; END IF;
  IF purchase.status<>'PENDING' OR purchase.checkout_url IS NOT NULL OR purchase.provider_transaction_id IS NOT NULL OR EXISTS(SELECT 1 FROM vote_ledger WHERE purchase_id=purchase.id) THEN
    RAISE EXCEPTION 'Purchase has checkout/payment/ledger evidence or requires review; automatic reset refused';
  END IF;
  IF purchase.init_started_at IS NULL THEN RAISE EXCEPTION 'Initialization has not been started; retry the original frontend request without resetting'; END IF;
  IF purchase.init_started_at>clock_timestamp()-interval '1 minute' THEN RAISE EXCEPTION 'Initialization may still be running; wait at least one minute'; END IF;
  IF purchase.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Test purchase window has expired; do not extend the immutable snapshot'; END IF;
  UPDATE vote_purchases SET init_started_at=NULL,last_error=NULL,last_verified_at=NULL,next_check_at=now() WHERE id=purchase.id;
END;
$retry_unopened_test_checkout$;
COMMIT;
