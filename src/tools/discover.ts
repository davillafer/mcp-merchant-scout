import { discoverMerchant } from "../lib/ucp-client.js";
import { addMerchant } from "../lib/merchant-registry.js";

export async function handleDiscover(args: { url: string }): Promise<string> {
  const baseUrl = args.url.replace(/\/+$/, "");

  const info = await discoverMerchant(baseUrl);

  addMerchant({
    url: baseUrl,
    info,
    discoveredAt: new Date().toISOString(),
  });

  return JSON.stringify(
    {
      name: info.name,
      description: info.description,
      url: baseUrl,
      ucpVersion: info.version,
      capabilities: info.capabilities,
      services: info.services,
      paymentHandlers: info.paymentHandlers,
      sandbox: info.sandbox,
    },
    null,
    2,
  );
}
