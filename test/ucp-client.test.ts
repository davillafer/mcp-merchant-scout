import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverMerchant, fetchProducts, fetchProduct, formatPrice } from '../src/lib/ucp-client.js';

function mockFetch(responses: Record<string, { ok: boolean; status: number; json: unknown; contentType?: string }>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = url.toString();
    // Find matching response (exact or prefix match)
    const resp = responses[urlStr] ?? Object.entries(responses).find(([key]) => urlStr.startsWith(key))?.[1];
    if (!resp) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => { throw new Error('not json'); },
        text: async () => 'Not Found',
      };
    }
    return {
      ok: resp.ok,
      status: resp.status,
      headers: new Headers({ 'content-type': resp.contentType ?? 'application/json' }),
      json: async () => resp.json,
      text: async () => JSON.stringify(resp.json),
    };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('discoverMerchant', () => {
  it('discovers a spec-format merchant via /.well-known/ucp', async () => {
    const profile = {
      ucp: {
        version: '2026-01-23',
        services: {
          'dev.ucp.shopping': [{
            transport: 'rest',
            endpoint: 'https://merchant.test/api/shopping',
          }],
        },
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: '2026-01-23' }],
        },
        payment_handlers: {
          'com.google.pay': [{ id: 'google_pay', version: '2026-01-23' }],
        },
        merchant: { name: 'Test Merchant', description: 'A test' },
      },
    };

    vi.stubGlobal('fetch', mockFetch({
      'https://merchant.test/.well-known/ucp': {
        ok: true, status: 200, json: profile,
      },
    }));

    const info = await discoverMerchant('https://merchant.test');
    expect(info.name).toBe('Test Merchant');
    expect(info.version).toBe('2026-01-23');
    expect(info.capabilities).toContain('dev.ucp.shopping.checkout');
    expect(info.services['dev.ucp.shopping']).toBe('https://merchant.test/api/shopping');
    expect(info.paymentHandlers).toContain('google_pay');
  });

  it('discovers a legacy-format merchant', async () => {
    const profile = {
      ucp: {
        version: '1.0',
        services: {
          checkout: '/api/ucp/checkout',
          products: '/api/ucp/products',
        },
        capabilities: ['dev.ucp.shopping.checkout', 'dev.ucp.shopping.catalog'],
        merchant: { name: 'Legacy Shop' },
        sandbox: true,
      },
      payment: {
        accepted_tokens: ['sandbox_*'],
      },
    };

    vi.stubGlobal('fetch', mockFetch({
      'https://legacy.test/.well-known/ucp': {
        ok: true, status: 200, json: profile,
      },
    }));

    const info = await discoverMerchant('https://legacy.test');
    expect(info.name).toBe('Legacy Shop');
    expect(info.sandbox).toBe(true);
    expect(info.services['products']).toContain('/api/ucp/products');
    expect(info.capabilities).toContain('dev.ucp.shopping.checkout');
  });

  it('falls back to /api/ucp/discovery', async () => {
    const profile = {
      ucp: {
        version: '1.0',
        services: { products: '/products' },
        capabilities: ['dev.ucp.shopping.catalog'],
        merchant: { name: 'Fallback' },
      },
    };

    vi.stubGlobal('fetch', mockFetch({
      'https://fallback.test/.well-known/ucp': { ok: true, status: 200, json: profile, contentType: 'text/html' },
      'https://fallback.test/api/ucp/discovery': { ok: true, status: 200, json: profile },
    }));

    const info = await discoverMerchant('https://fallback.test');
    expect(info.name).toBe('Fallback');
  });

  it('throws when no discovery endpoint responds', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    await expect(discoverMerchant('https://nothing.test')).rejects.toThrow('Discovery failed');
  });

  it('handles spec payment_handlers as keyed object', async () => {
    const profile = {
      ucp: {
        version: '2026-01-23',
        services: { 'dev.ucp.shopping': [{ transport: 'rest', endpoint: '/api' }] },
        capabilities: {},
        payment_handlers: {
          'com.stripe': [{ id: 'stripe_pay', version: '2026-01-23' }],
          'com.paypal': [{ id: 'paypal', version: '2026-01-23' }],
        },
        merchant: { name: 'Multi-Pay' },
      },
    };

    vi.stubGlobal('fetch', mockFetch({
      'https://multi.test/.well-known/ucp': { ok: true, status: 200, json: profile },
    }));

    const info = await discoverMerchant('https://multi.test');
    expect(info.paymentHandlers).toContain('stripe_pay');
    expect(info.paymentHandlers).toContain('paypal');
  });
});

describe('fetchProducts', () => {
  it('tries POST /catalog/search first (spec)', async () => {
    const products = [
      { id: 'p1', title: 'Widget', variants: [{ id: 'v1', price: { amount: '999', currency: 'USD' }, available: true }] },
    ];

    vi.stubGlobal('fetch', mockFetch({
      'https://spec.test/api/shopping/catalog/search': {
        ok: true, status: 200, json: { products },
      },
    }));

    const result = await fetchProducts(
      'https://spec.test',
      { 'dev.ucp.shopping': 'https://spec.test/api/shopping' },
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Widget');
    expect(result[0].price).toBe(9.99);
  });

  it('falls back to GET /products for legacy', async () => {
    const products = [
      { id: 'p1', name: 'Book', price: 18.74, currency: 'USD', in_stock: true },
    ];

    vi.stubGlobal('fetch', mockFetch({
      'https://legacy.test/api/ucp/products': {
        ok: true, status: 200, json: { products },
      },
    }));

    const result = await fetchProducts(
      'https://legacy.test',
      { products: 'https://legacy.test/api/ucp/products' },
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Book');
    expect(result[0].price).toBe(18.74);
  });

  it('applies client-side query filter', async () => {
    const products = [
      { id: 'p1', name: 'Sci-fi Book', price: 15, currency: 'USD', in_stock: true },
      { id: 'p2', name: 'Cooking Guide', price: 20, currency: 'USD', in_stock: true },
    ];

    vi.stubGlobal('fetch', mockFetch({
      'https://legacy.test/products': {
        ok: true, status: 200, json: { products },
      },
    }));

    const result = await fetchProducts(
      'https://legacy.test',
      { products: 'https://legacy.test/products' },
      'sci-fi',
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toContain('Sci-fi');
  });
});

describe('fetchProduct', () => {
  it('tries POST /catalog/lookup first (spec)', async () => {
    const product = {
      id: 'p1', title: 'Widget',
      variants: [{ id: 'v1', price: { amount: '999', currency: 'USD' }, available: true }],
    };

    vi.stubGlobal('fetch', mockFetch({
      'https://spec.test/api/shopping/catalog/lookup': {
        ok: true, status: 200, json: { products: [product] },
      },
    }));

    const result = await fetchProduct(
      'https://spec.test',
      { 'dev.ucp.shopping': 'https://spec.test/api/shopping' },
      'p1',
    );

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Widget');
  });

  it('falls back to GET /products/:id for legacy', async () => {
    const product = { id: 'book-1', name: 'My Book', price: 10, currency: 'USD', in_stock: true };

    vi.stubGlobal('fetch', mockFetch({
      'https://legacy.test/api/products/book-1': {
        ok: true, status: 200, json: { product },
      },
    }));

    const result = await fetchProduct(
      'https://legacy.test',
      { products: 'https://legacy.test/api/products' },
      'book-1',
    );

    expect(result).not.toBeNull();
    expect(result!.name).toBe('My Book');
  });
});

describe('formatPrice', () => {
  it('formats prices correctly', () => {
    expect(formatPrice(18.74, 'USD')).toBe('USD $18.74');
    expect(formatPrice(0, 'USD')).toBe('USD $0.00');
  });
});
