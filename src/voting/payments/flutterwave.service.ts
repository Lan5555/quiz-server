import { HttpException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { equal, fail, VotingConfig } from '../common/voting';
import type { PurchaseRecord } from '../purchases/purchase.record';

export interface ProviderTransaction {
  id: number | string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  domain: string;
  account_id: string;
  paid_at: string | null;
  created_at: string;
}
interface FlutterwaveTransaction {
  id: number | string;
  tx_ref: string;
  status: string;
  amount: number | string;
  currency: string;
  account_id: number | string;
  created_at: string;
}
interface FlutterwaveRefund {
  id: number | string;
  amount_refunded: number | string;
  status: string;
  account_id: number | string;
  transaction_id: number | string;
}
interface Envelope<T> {
  status: string;
  data: T;
  meta?: { page_info?: { total_pages: number; current_page: number } };
}
export class FlutterwaveProviderError extends HttpException {
  constructor(readonly diagnostic: string) {
    super(
      {
        success: false,
        message:
          'Payment provider temporarily unavailable. Keep this attempt and retry.',
        data: null,
      },
      503,
    );
  }
}

export function flutterwaveFailureCode(error: unknown): string {
  if (error instanceof FlutterwaveProviderError) return error.diagnostic;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (
      Number.isInteger(status) &&
      Number(status) >= 100 &&
      Number(status) <= 599
    )
      return `HTTP_${status}`;
    if (
      [
        'EACCES',
        'EPERM',
        'ETIMEDOUT',
        'ECONNABORTED',
        'ECONNREFUSED',
        'ENOTFOUND',
        'ECONNRESET',
        'ERR_NETWORK',
        'EAI_AGAIN',
        'ERR_BAD_OPTION_VALUE',
        'ERR_BAD_OPTION',
        'ERR_BAD_REQUEST',
        'ERR_BAD_RESPONSE',
        'ERR_INVALID_URL',
        'ERR_CANCELED',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'CERT_HAS_EXPIRED',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'ERR_SSL_WRONG_VERSION_NUMBER',
      ].includes(error.code || '')
    )
      return error.code!;
  }
  return 'UNKNOWN_PROVIDER_ERROR';
}

export function parseFlutterwaveResponse(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(
        raw.replace(
          /("(?:id|account_id|transaction_id)"\s*:\s*)(\d{16,})/g,
          '$1"$2"',
        ),
      ) as unknown;
    } catch {
      /* Preserve HTTP status when an error response is HTML or empty. */
    }
  }
  return { status: '__INVALID_JSON__', data: null };
}

export function toMinor(value: unknown): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) fail(503, 'Invalid payment amount received from provider');
  const amount =
    BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (amount < 1n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    fail(503, 'Invalid payment amount received from provider');
  return Number(amount);
}
export function toMajor(minor: string | number): string {
  const value = BigInt(minor);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  constructor(private readonly config: VotingConfig) {}
  private mode() {
    const secret = this.config.required('FLUTTERWAVE_SECRET_KEY');
    const mode = secret.startsWith('FLWSECK_TEST-')
      ? 'test'
      : secret.startsWith('FLWSECK-')
        ? 'live'
        : null;
    if (!mode || mode !== this.config.required('VOTING_PROVIDER_MODE'))
      fail(503, 'Flutterwave key mode is not configured correctly');
    return mode;
  }
  private async request<T>(path: string, body?: unknown): Promise<Envelope<T>> {
    this.mode();
    try {
      const result = await axios.request<Envelope<T>>({
        baseURL: 'https://api.flutterwave.com/v3',
        url: path,
        method: body ? 'POST' : 'GET',
        data: body,
        timeout: 12000,
        maxRedirects: 0,
        headers: {
          Authorization: `Bearer ${this.config.required('FLUTTERWAVE_SECRET_KEY')}`,
        },
        transformResponse: [parseFlutterwaveResponse],
      });
      if (result.data?.status === '__INVALID_JSON__')
        throw new FlutterwaveProviderError('INVALID_PROVIDER_JSON');
      if (result.data?.status !== 'success' || result.data.data == null)
        throw new FlutterwaveProviderError('RESPONSE_REJECTED');
      return result.data;
    } catch (error) {
      const diagnostic = flutterwaveFailureCode(error);
      const operation =
        path === '/payments'
          ? 'INITIALIZE_CHECKOUT'
          : path.startsWith('/refunds')
            ? 'CHECK_REFUNDS'
            : 'VERIFY_PAYMENT';
      this.logger.error(`Flutterwave ${operation} failed: ${diagnostic}`);
      throw new FlutterwaveProviderError(diagnostic);
    }
  }
  assertCanInitialize(p: PurchaseRecord) {
    this.config.enabled();
    if (this.mode() !== p.provider_mode)
      fail(
        503,
        'Purchase belongs to a different Flutterwave mode. Contact support.',
      );
  }
  async initialize(p: PurchaseRecord) {
    const response = await this.request<{ link: string }>('/payments', {
      tx_ref: p.provider_reference,
      amount: toMajor(p.amount),
      currency: 'NGN',
      redirect_url: `${this.config.frontend()}/pages/votes/payment?purchaseId=${p.id}`,
      customer: { email: p.email },
      customizations: { title: 'Vote purchase' },
      configurations: {
        session_duration: Math.max(
          1,
          Math.ceil((new Date(p.expires_at).getTime() - Date.now()) / 60000),
        ),
        max_retry_attempt: 3,
      },
    });
    return this.checkoutUrl(response.data.link);
  }
  checkoutUrl(value: unknown): string {
    let url: URL;
    try {
      url = new URL(String(value));
    } catch {
      throw new FlutterwaveProviderError('CHECKOUT_URL_INVALID');
    }
    const mode = this.config.get('VOTING_PROVIDER_MODE');
    const allowedHosts = ['checkout.flutterwave.com'];
    if (mode === 'test') allowedHosts.push('checkout-v2.dev-flutterwave.com');
    if (
      url.protocol !== 'https:' ||
      !allowedHosts.includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    ) {
      const host = /^[a-z0-9.-]{1,253}$/i.test(url.hostname)
        ? url.hostname
        : '[invalid-host]';
      const configuredMode =
        mode === 'test' || mode === 'live' ? mode : 'unconfigured';
      this.logger.error(
        `Flutterwave checkout URL rejected: host=${host}; protocol=${url.protocol}; mode=${configuredMode}`,
      );
      throw new FlutterwaveProviderError('CHECKOUT_URL_REJECTED');
    }
    return url.toString();
  }
  async verify(reference: string): Promise<ProviderTransaction> {
    const { data: t } = await this.request<FlutterwaveTransaction>(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    return this.normalize(t);
  }
  async verifyId(id: string): Promise<ProviderTransaction> {
    if (!/^[1-9][0-9]*$/.test(id)) fail(400, 'Invalid transaction identifier');
    const { data: t } = await this.request<FlutterwaveTransaction>(
      `/transactions/${encodeURIComponent(id)}/verify`,
    );
    if (String(t.id) !== id)
      throw new FlutterwaveProviderError('TRANSACTION_ID_MISMATCH');
    return this.normalize(t);
  }
  private normalize(t: FlutterwaveTransaction): ProviderTransaction {
    return {
      id: t.id,
      reference: t.tx_ref,
      status: t.status === 'successful' ? 'success' : t.status,
      amount: toMinor(t.amount),
      currency: t.currency,
      domain: this.mode(),
      account_id: String(t.account_id),
      created_at: t.created_at,
      paid_at: t.status === 'successful' ? t.created_at : null,
    };
  }
  async refundState(
    t: ProviderTransaction,
  ): Promise<'NONE' | 'FULL' | 'REVIEW'> {
    const refunds = new Map<string, FlutterwaveRefund>();
    for (let page = 1; page <= 100; page++) {
      const response = await this.request<FlutterwaveRefund[]>(
        `/refunds?id=${encodeURIComponent(String(t.id))}&from=${encodeURIComponent(t.created_at.slice(0, 10))}&to=${new Date().toISOString().slice(0, 10)}&page=${page}`,
      );
      if (!Array.isArray(response.data))
        fail(503, 'Refund evidence temporarily unavailable');
      for (const r of response.data) {
        if (
          String(r.transaction_id) !== String(t.id) ||
          String(r.account_id) !== t.account_id
        )
          fail(503, 'Refund evidence does not match the payment');
        refunds.set(String(r.id), r);
      }
      const pages = response.meta?.page_info?.total_pages;
      if (!Number.isInteger(pages) || Number(pages) < 0 || Number(pages) > 100)
        fail(503, 'Refund pagination evidence unavailable');
      if (page >= Number(pages)) {
        const relevant = [...refunds.values()].filter(
          (r) => r.status !== 'failed',
        );
        if (!relevant.length) return 'NONE';
        const final = [
          'completed-bank-transfer',
          'completed-momo',
          'completed-mpgs',
          'completed-offline',
          'completed-preauth',
        ];
        // Plain "completed" means initiated/pending disbursement, not final.
        return relevant.length === 1 &&
          final.includes(relevant[0].status) &&
          toMinor(relevant[0].amount_refunded) === t.amount
          ? 'FULL'
          : 'REVIEW';
      }
    }
    fail(503, 'Refund evidence requires reconciliation');
  }
  signature(raw: Buffer | undefined, header: string | undefined) {
    if (
      !raw ||
      !header ||
      !equal(header, this.config.required('FLUTTERWAVE_SECRET_HASH'))
    )
      fail(401, 'Invalid webhook authentication');
  }
}
