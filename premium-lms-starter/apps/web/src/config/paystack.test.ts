// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPaystackAuthorizationUrl,
  readPaystackConfig,
  redirectToPaystack,
  PAYSTACK_INLINE_SCRIPT_URL,
} from './paystack.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browser Paystack config', () => {
  it('reads only a valid public key from VITE_PAYSTACK_PUBLIC_KEY', () => {
    expect(readPaystackConfig({ VITE_PAYSTACK_PUBLIC_KEY: 'pk_test_lms_unit_test_public_key' })).toEqual({
      publicKey: 'pk_test_lms_unit_test_public_key',
      enabled: true,
    });
    expect(readPaystackConfig({}).enabled).toBe(false);
    expect(readPaystackConfig({ VITE_PAYSTACK_PUBLIC_KEY: 'sk_live_server_secret_must_not_be_used' }).enabled).toBe(
      false,
    );
  });

  it('loads the committed fake test key from the root .env.test file', () => {
    expect(readPaystackConfig().publicKey).toBe('pk_test_lms_unit_test_public_key');
    expect(readPaystackConfig().enabled).toBe(true);
  });

  it('allows only Paystack-owned HTTPS redirect targets', () => {
    expect(isPaystackAuthorizationUrl('https://checkout.paystack.com/access-code')).toBe(true);
    expect(isPaystackAuthorizationUrl('https://paystack.co/secure')).toBe(true);
    expect(isPaystackAuthorizationUrl('http://checkout.paystack.com/access-code')).toBe(false);
    expect(isPaystackAuthorizationUrl('https://checkout.paystack.com.evil.example/')).toBe(false);
    expect(isPaystackAuthorizationUrl('not a url')).toBe(false);
  });

  it('redirects through window.open only for a validated Paystack URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    redirectToPaystack('https://checkout.paystack.com/access-code');
    expect(open).toHaveBeenCalledWith('https://checkout.paystack.com/access-code', '_self');
    expect(() => redirectToPaystack('https://evil.example/')).toThrow(/Unsafe/);
    expect(PAYSTACK_INLINE_SCRIPT_URL).toBe('https://js.paystack.co/v1/inline.js');
  });
});
