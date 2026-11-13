import {
  automaticPaymentReview,
  paymentDecision,
} from './vote-accounting.service';
import type { PurchaseRecord } from '../purchases/purchase.record';
import type { ProviderTransaction } from './flutterwave.service';

describe('automatic successful vote payment policy', () => {
  const purchase = {
    provider_reference: 'vote-fixture',
    provider_mode: 'test',
    provider_account_id: '123',
    amount: '10000',
    accepted_at: new Date('2026-01-01T00:00:00Z'),
    expires_at: new Date('2026-01-01T00:30:00Z'),
  } as PurchaseRecord;
  const transaction: ProviderTransaction = {
    id: '123456',
    reference: 'vote-fixture',
    domain: 'test',
    account_id: '123',
    status: 'success',
    amount: 10000,
    currency: 'NGN',
    created_at: '2026-01-02T00:00:00Z',
    paid_at: '2026-01-02T00:00:00Z',
  };
  it('credits exact server-verified success regardless of provider timestamps', () => {
    expect(paymentDecision(purchase, transaction, true, 'test')).toBe('CREDIT');
    expect(
      paymentDecision(
        purchase,
        { ...transaction, paid_at: null, created_at: 'invalid' },
        true,
        'test',
      ),
    ).toBe('CREDIT');
  });
  it.each([
    { amount: 1 },
    { currency: 'USD' },
    { reference: 'another-order' },
    { domain: 'live' },
  ])('retains review for mismatched payment identity: %j', (overrides) => {
    expect(
      paymentDecision(purchase, { ...transaction, ...overrides }, true, 'test'),
    ).toBe('REVIEW');
  });
  it('keeps pending and disqualified payments from being credited', () => {
    expect(
      paymentDecision(
        purchase,
        { ...transaction, status: 'pending' },
        true,
        'test',
      ),
    ).toBe('PENDING');
    expect(paymentDecision(purchase, transaction, false, 'test')).toBe(
      'REVIEW',
    );
  });
  it('ignores the legacy configured account snapshot for key-scoped verified success', () => {
    expect(
      paymentDecision(
        purchase,
        { ...transaction, account_id: '98765' },
        true,
        'test',
      ),
    ).toBe('CREDIT');
  });
  it('recovers automatic reviews while keeping manual and refund holds', () => {
    expect(
      automaticPaymentReview({
        review_reason: 'PAYMENT_AFTER_CHECKOUT_EXPIRY',
      }),
    ).toBe(true);
    expect(
      automaticPaymentReview({ review_reason: 'PAYMENT_EVIDENCE_MISMATCH' }),
    ).toBe(true);
    expect(
      automaticPaymentReview({
        review_reason: 'DISPUTE_REQUIRES_RECONCILIATION',
      }),
    ).toBe(false);
    expect(
      automaticPaymentReview({ review_reason: 'REVERSAL_EVIDENCE_REQUIRED' }),
    ).toBe(false);
    expect(automaticPaymentReview({ review_reason: null })).toBe(false);
  });
});
