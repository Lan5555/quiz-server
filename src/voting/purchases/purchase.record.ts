export interface PurchaseRecord {
  provider: 'paystack' | 'flutterwave';
  provider_account_id: string | null;
  provider_mode: 'test' | 'live' | null;
  id: string;
  poll_id: string;
  candidate_id: string;
  quantity: number;
  price: string;
  amount: string;
  currency: 'NGN';
  email: string;
  poll_title: string;
  candidate_name: string;
  idempotency_key: string;
  request_hash: string;
  provider_reference: string;
  provider_transaction_id: string | null;
  receipt_hash: string;
  receipt_encrypted: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REVIEW' | 'REFUNDED';
  accepted_at: Date;
  expires_at: Date;
  paid_at: Date | null;
  checkout_url: string | null;
  init_started_at: Date | null;
  last_error: string | null;
  review_reason: string | null;
}
