/**
 * Browser-safe Paystack configuration.
 *
 * Only `VITE_PAYSTACK_PUBLIC_KEY` is read here. It is a public key and is
 * intentionally visible in the browser bundle. `PAYSTACK_SECRET_KEY` is
 * server-only and must never be added to Vite or this module.
 */

const PUBLIC_KEY_PATTERN = /^pk_(test|live)_[A-Za-z0-9_-]{8,}$/;
export const PAYSTACK_INLINE_SCRIPT_URL = 'https://js.paystack.co/v1/inline.js';

export interface PaystackClientConfig {
  publicKey: string;
  enabled: boolean;
}

type PaystackEnv = {
  VITE_PAYSTACK_PUBLIC_KEY?: unknown;
  [key: string]: unknown;
};

export function readPaystackConfig(env: PaystackEnv = import.meta.env): PaystackClientConfig {
  const publicKey = String(env.VITE_PAYSTACK_PUBLIC_KEY ?? '').trim();
  return { publicKey, enabled: PUBLIC_KEY_PATTERN.test(publicKey) };
}

export function isPaystackEnabled(): boolean {
  return readPaystackConfig().enabled;
}

export function paystackPublicKey(): string {
  return readPaystackConfig().publicKey;
}

/** Defence in depth: only redirect to Paystack-owned HTTPS hosts. */
export function isPaystackAuthorizationUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'paystack.com' ||
    host === 'paystack.co' ||
    host.endsWith('.paystack.com') ||
    host.endsWith('.paystack.co')
  );
}

export function redirectToPaystack(url: string, win: Window = window): void {
  if (!isPaystackAuthorizationUrl(url)) {
    throw new Error('Unsafe Paystack redirect rejected.');
  }
  win.open(url, '_self');
}

export interface PaystackInlineResponse {
  reference?: string;
  trxref?: string;
  status?: string;
}

export interface PaystackInlineHandler {
  openIframe(): void;
}

export interface PaystackInlineOptions {
  key: string;
  email: string;
  access_code: string;
  onClose: () => void;
  callback: (response: PaystackInlineResponse) => void;
}

export interface PaystackInlineApi {
  setup(options: PaystackInlineOptions): PaystackInlineHandler;
}

declare global {
  interface Window {
    PaystackPop?: PaystackInlineApi;
  }
}

/** Load Paystack Inline once; return null when the script is unavailable. */
export function loadPaystackInline(): Promise<PaystackInlineApi | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop);

  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-paystack-inline="true"]',
  );
  if (existing) {
    return new Promise((resolve) => {
      let settled = false;
      let timer: number | undefined;
      const finish = (value: PaystackInlineApi | null) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) window.clearTimeout(timer);
        resolve(value);
      };
      timer = window.setTimeout(() => finish(window.PaystackPop ?? null), 5_000);
      existing.addEventListener('load', () => finish(window.PaystackPop ?? null), { once: true });
      existing.addEventListener('error', () => finish(null), { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = PAYSTACK_INLINE_SCRIPT_URL;
    script.async = true;
    script.dataset.paystackInline = 'true';
    script.onload = () => resolve(window.PaystackPop ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}
