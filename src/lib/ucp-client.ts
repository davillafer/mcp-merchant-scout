/**
 * HTTP client for UCP (Universal Commerce Protocol) endpoints.
 * Handles multiple merchant API formats:
 * - UCP spec-compliant (POST /catalog/search, /catalog/lookup)
 * - Pudding Heroes sandbox (GET /api/ucp/products)
 * - Google UCP demo (/.well-known/ucp with Cloudflare Workers backend)
 */

// --- Normalized types (what our tools work with) ---

export interface MerchantInfo {
  name: string;
  description?: string;
  version: string;
  capabilities: string[];
  services: Record<string, string>; // service name -> endpoint path
  paymentHandlers: string[];
  sandbox: boolean;
  rawProfile: unknown;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number; // in dollars
  currency: string;
  inStock: boolean;
  type?: string;
  imageUrl?: string;
  fulfillment?: string;
  variants?: Variant[];
  options?: Record<string, string>;
}

export interface Variant {
  id: string;
  title: string;
  price: number;
  currency: string;
  available: boolean;
  options?: Array<{ name: string; value: string }>;
}

// --- Discovery ---

function ucpAgentHeader(baseUrl: string): string {
  return `profile="${new URL("/.well-known/ucp", baseUrl).toString()}"`;
}

/** Try multiple discovery URL patterns and return the first that works */
export async function discoverMerchant(baseUrl: string): Promise<MerchantInfo> {
  const discoveryPaths = [
    "/.well-known/ucp",
    "/api/ucp/discovery",
  ];

  let lastError: Error | null = null;

  for (const path of discoveryPaths) {
    try {
      const url = new URL(path, baseUrl).toString();
      const response = await fetch(url, {
        headers: {
          "UCP-Agent": ucpAgentHeader(baseUrl),
          Accept: "application/json",
        },
      });

      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        // Some /.well-known/ucp endpoints return HTML — skip
        continue;
      }

      const data = await response.json();
      return parseDiscoveryProfile(baseUrl, data);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw new Error(
    `Discovery failed for ${baseUrl}. Tried /.well-known/ucp and /api/ucp/discovery. ${lastError?.message ?? ""}`,
  );
}

/** Parse various discovery profile formats into a normalized MerchantInfo */
function parseDiscoveryProfile(baseUrl: string, data: any): MerchantInfo {
  const ucp = data.ucp ?? data;

  // Extract capabilities
  let capabilities: string[] = [];
  if (Array.isArray(ucp.capabilities)) {
    // Legacy: flat string array
    capabilities = ucp.capabilities;
  } else if (ucp.capabilities && typeof ucp.capabilities === "object" && !Array.isArray(ucp.capabilities)) {
    // Spec: object keyed by reverse-domain { "dev.ucp.shopping.checkout": [...] }
    capabilities = Object.keys(ucp.capabilities);
  }

  // Also check top-level capabilities (some formats)
  if (capabilities.length === 0 && Array.isArray(data.capabilities)) {
    capabilities = data.capabilities;
  }

  // Fallback: extract from nested service capabilities
  if (capabilities.length === 0 && ucp.services && typeof ucp.services === "object") {
    for (const svc of Object.values(ucp.services) as any[]) {
      const svcObj = Array.isArray(svc) ? svc[0] : svc;
      if (svcObj && Array.isArray(svcObj.capabilities)) {
        for (const cap of svcObj.capabilities) {
          capabilities.push(typeof cap === "string" ? cap : cap.name);
        }
      }
    }
  }

  // Extract service endpoints
  const services: Record<string, string> = {};

  // ucp.services can be:
  // Legacy: { checkout: "/path", products: "/path" }
  // Spec: { "dev.ucp.shopping": [{ transport: "rest", endpoint: "..." }] }
  // Sample: { "dev.ucp.shopping": { rest: { endpoint: "..." } } }
  if (ucp.services && typeof ucp.services === "object") {
    for (const [key, val] of Object.entries(ucp.services)) {
      if (typeof val === "string") {
        // Legacy flat paths
        services[key] = new URL(val, baseUrl).toString();
      } else if (Array.isArray(val)) {
        // Spec: array of transport bindings
        for (const binding of val as any[]) {
          if (binding.transport === "rest" && binding.endpoint) {
            services[key] = binding.endpoint.startsWith("http")
              ? binding.endpoint
              : new URL(binding.endpoint, baseUrl).toString();
          }
        }
      } else if (typeof val === "object" && val !== null) {
        // Sample variant: nested rest.endpoint
        const svc = val as any;
        if (svc.rest?.endpoint) {
          services[key] = svc.rest.endpoint.startsWith("http")
            ? svc.rest.endpoint
            : new URL(svc.rest.endpoint, baseUrl).toString();
        } else if (svc.endpoint) {
          services[key] = svc.endpoint.startsWith("http")
            ? svc.endpoint
            : new URL(svc.endpoint, baseUrl).toString();
        }
      }
    }
  }

  // Spec format: services is an array with types.rest.servers
  if (Array.isArray(data.services)) {
    for (const svc of data.services) {
      const serverUrl = svc.types?.rest?.servers?.[0]?.url ?? "/";
      services[svc.id] = serverUrl.startsWith("http")
        ? serverUrl
        : new URL(serverUrl, baseUrl).toString();
    }
  }

  // Extract payment handlers
  const paymentHandlers: string[] = [];

  // Spec: ucp.payment_handlers is an object keyed by reverse-domain, values are arrays
  const ucpHandlers = ucp.payment_handlers;
  if (ucpHandlers && typeof ucpHandlers === "object" && !Array.isArray(ucpHandlers)) {
    for (const arr of Object.values(ucpHandlers) as any[]) {
      if (Array.isArray(arr)) {
        for (const h of arr) {
          paymentHandlers.push(h.id ?? h.name ?? "unknown");
        }
      }
    }
  }

  // Fallback: payment.handlers (array) or top-level payment_handlers (array)
  if (paymentHandlers.length === 0) {
    const handlers =
      data.payment_handlers ?? data.payment?.handlers;
    if (Array.isArray(handlers)) {
      for (const h of handlers) {
        paymentHandlers.push(h.id ?? h.name ?? "unknown");
      }
    }
  }

  // Merchant name
  const name =
    ucp.merchant?.name ??
    data.name ??
    new URL(baseUrl).hostname;

  return {
    name,
    description: ucp.merchant?.description ?? data.description,
    version: ucp.version ?? "unknown",
    capabilities,
    services,
    paymentHandlers,
    sandbox: ucp.sandbox ?? data.sandbox ?? false,
    rawProfile: data,
  };
}

// --- Product fetching ---

/** Fetch all products from a merchant, handling different API formats */
export async function fetchProducts(
  merchantUrl: string,
  services: Record<string, string>,
  query?: string,
  filters?: { maxPrice?: number; minPrice?: number; type?: string },
  context?: { country?: string; currency?: string },
): Promise<Product[]> {
  const ctx = { country: context?.country ?? "US", currency: context?.currency ?? "USD" };
  const agentHeader = ucpAgentHeader(merchantUrl);

  // 1. Try spec-compliant POST /catalog/search first
  for (const endpoint of Object.values(services)) {
    try {
      const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
      const response = await fetch(base + "/catalog/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "UCP-Agent": agentHeader,
        },
        body: JSON.stringify({
          query: query ?? "",
          context: ctx,
          pagination: { first: 50 },
        }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (data.products) {
        return normalizeProducts(data, query, filters);
      }
    } catch {
      continue;
    }
  }

  // 2. Fallback to legacy GET-based endpoints
  const endpointAttempts = [
    services.products,
    services.catalog,
    new URL("/api/ucp/products", merchantUrl).toString(),
  ].filter(Boolean) as string[];

  for (const endpoint of endpointAttempts) {
    try {
      const url = new URL(endpoint);
      if (filters?.maxPrice) url.searchParams.set("max_price", filters.maxPrice.toString());
      if (filters?.type) url.searchParams.set("type", filters.type);
      if (query) url.searchParams.set("q", query);

      const response = await fetch(url.toString(), {
        headers: { "UCP-Agent": agentHeader },
      });

      if (!response.ok) continue;

      const data = await response.json();
      return normalizeProducts(data, query, filters);
    } catch {
      continue;
    }
  }

  throw new Error("Could not fetch products from any known endpoint.");
}

/** Fetch a single product by ID */
export async function fetchProduct(
  merchantUrl: string,
  services: Record<string, string>,
  productId: string,
  context?: { country?: string; currency?: string },
): Promise<Product | null> {
  const ctx = { country: context?.country ?? "US", currency: context?.currency ?? "USD" };
  const agentHeader = ucpAgentHeader(merchantUrl);

  // 1. Try spec-compliant POST /catalog/lookup first
  for (const endpoint of Object.values(services)) {
    try {
      const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
      const response = await fetch(base + "/catalog/lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "UCP-Agent": agentHeader,
        },
        body: JSON.stringify({
          ids: [productId],
          context: ctx,
        }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (data.products?.[0]) {
        return normalizeSingleProduct(data.products[0]);
      }
    } catch {
      continue;
    }
  }

  // 2. Fallback to legacy GET /products/:id
  const productEndpoints = [
    services.products,
    new URL("/api/ucp/products", merchantUrl).toString(),
  ].filter(Boolean) as string[];

  for (const endpoint of productEndpoints) {
    try {
      const base = endpoint.endsWith("/") ? endpoint : endpoint + "/";
      const url = base + encodeURIComponent(productId);
      const response = await fetch(url, {
        headers: { "UCP-Agent": agentHeader },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const productData = data.product ?? data;
      return normalizeSingleProduct(productData);
    } catch {
      continue;
    }
  }

  return null;
}

// --- Normalization ---

function normalizeProducts(
  data: any,
  query?: string,
  filters?: { maxPrice?: number; minPrice?: number },
): Product[] {
  const rawProducts: any[] = data.products ?? (Array.isArray(data) ? data : []);

  let products = rawProducts.map(normalizeSingleProduct).filter(Boolean) as Product[];

  // Client-side text search if the API didn't handle it
  if (query) {
    const q = query.toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.type?.toLowerCase().includes(q),
    );
  }

  // Client-side price filtering
  if (filters?.maxPrice) {
    products = products.filter((p) => p.price <= filters.maxPrice!);
  }
  if (filters?.minPrice) {
    products = products.filter((p) => p.price >= filters.minPrice!);
  }

  return products;
}

function normalizeSingleProduct(raw: any): Product | null {
  if (!raw) return null;

  // Handle spec-compliant format (variants with minor units)
  if (raw.variants && Array.isArray(raw.variants)) {
    const variants: Variant[] = raw.variants.map((v: any) => ({
      id: v.id,
      title: v.title ?? "",
      price: typeof v.price === "object"
        ? parseInt(v.price.amount, 10) / 100
        : Number(v.price),
      currency: typeof v.price === "object" ? v.price.currency : "USD",
      available: v.available ?? true,
      options: v.selected_options,
    }));

    const cheapest = variants.sort((a, b) => a.price - b.price)[0];

    return {
      id: raw.id,
      name: raw.title ?? raw.name ?? "Unknown",
      description: raw.description ?? "",
      price: cheapest?.price ?? 0,
      currency: cheapest?.currency ?? "USD",
      inStock: variants.some((v) => v.available),
      type: raw.type,
      imageUrl: raw.media?.[0]?.url ?? raw.image_url,
      variants,
    };
  }

  // Handle flat product format (Pudding Heroes style)
  return {
    id: raw.id ?? raw.product_id ?? "unknown",
    name: raw.name ?? raw.title ?? "Unknown",
    description: raw.description ?? "",
    price: Number(raw.price ?? 0),
    currency: raw.currency ?? "USD",
    inStock: raw.in_stock ?? raw.available ?? true,
    type: raw.type,
    imageUrl: raw.image_url ?? raw.media?.[0]?.url,
    fulfillment: raw.fulfillment,
    options: raw.selected_options
      ? Object.fromEntries(raw.selected_options.map((o: any) => [o.name, o.value]))
      : undefined,
  };
}

/** Format a price in dollars to human-readable */
export function formatPrice(price: number, currency: string = "USD"): string {
  return `${currency} $${price.toFixed(2)}`;
}
