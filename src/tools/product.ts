import { fetchProduct, formatPrice } from "../lib/ucp-client.js";
import { getMerchant } from "../lib/merchant-registry.js";

export async function handleGetProduct(args: {
  merchantUrl: string;
  productId: string;
}): Promise<string> {
  const merchant = getMerchant(args.merchantUrl);
  if (!merchant) {
    return JSON.stringify({
      error: `Merchant "${args.merchantUrl}" not found. Use discover_merchant first.`,
    });
  }

  const product = await fetchProduct(
    merchant.url,
    merchant.info.services,
    args.productId,
  );

  if (!product) {
    return JSON.stringify({
      error: `Product "${args.productId}" not found at ${merchant.info.name}.`,
    });
  }

  return JSON.stringify(
    {
      merchant: merchant.info.name,
      merchantUrl: merchant.url,
      id: product.id,
      name: product.name,
      description: product.description,
      price: formatPrice(product.price, product.currency),
      priceRaw: product.price,
      currency: product.currency,
      inStock: product.inStock,
      type: product.type,
      imageUrl: product.imageUrl,
      fulfillment: product.fulfillment,
      variants: product.variants?.map((v) => ({
        id: v.id,
        title: v.title,
        price: formatPrice(v.price, v.currency),
        available: v.available,
        options: v.options,
      })),
    },
    null,
    2,
  );
}
