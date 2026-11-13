-- Read-only diagnostics. No payer email, idempotency key, receipt token or encryption material.
SELECT id AS purchase_id, provider_reference, provider_mode, status,
       amount AS amount_minor, currency, quantity, accepted_at, expires_at,
       init_started_at, checkout_url IS NOT NULL AS has_checkout_url,
       provider_transaction_id, provider_account_id AS saved_account_id,
       review_reason, last_error
FROM vote_purchases
WHERE provider='flutterwave'
ORDER BY accepted_at DESC
LIMIT 10;
