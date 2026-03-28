/**
 * In-memory registry of discovered UCP merchants.
 * Persists only for the lifetime of the MCP server process.
 */

import type { MerchantInfo } from "./ucp-client.js";

export interface RegisteredMerchant {
  url: string;
  info: MerchantInfo;
  discoveredAt: string;
}

const merchants = new Map<string, RegisteredMerchant>();

export function addMerchant(merchant: RegisteredMerchant): void {
  merchants.set(merchant.url, merchant);
}

export function getMerchant(url: string): RegisteredMerchant | undefined {
  return merchants.get(url);
}

export function getAllMerchants(): RegisteredMerchant[] {
  return Array.from(merchants.values());
}

export function getMerchantsByCapability(
  capability: string,
): RegisteredMerchant[] {
  return getAllMerchants().filter((m) =>
    m.info.capabilities.some((c) => c.includes(capability)),
  );
}

export function removeMerchant(url: string): boolean {
  return merchants.delete(url);
}

export function clearMerchants(): void {
  merchants.clear();
}
