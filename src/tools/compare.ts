import { fetchProduct, formatPrice } from "../lib/ucp-client.js";
import { getMerchant } from "../lib/merchant-registry.js";

interface ProductRef {
  merchantUrl: string;
  productId: string;
}

export async function handleCompare(args: {
  products: ProductRef[];
}): Promise<string> {
  if (args.products.length < 2) {
    return JSON.stringify({ error: "Need at least 2 products to compare." });
  }
  if (args.products.length > 5) {
    return JSON.stringify({ error: "Maximum 5 products for comparison." });
  }

  const results = await Promise.allSettled(
    args.products.map(async (ref) => {
      const merchant = getMerchant(ref.merchantUrl);
      if (!merchant)
        throw new Error(`Merchant "${ref.merchantUrl}" not found`);

      const product = await fetchProduct(
        merchant.url,
        merchant.info.services,
        ref.productId,
      );

      if (!product)
        throw new Error(
          `Product "${ref.productId}" not found at ${merchant.info.name}`,
        );

      return { merchantName: merchant.info.name, product };
    }),
  );

  const comparison: Array<{
    merchant: string;
    id: string;
    name: string;
    price: string;
    priceRaw: number;
    inStock: boolean;
    type?: string;
    fulfillment?: string;
    variantCount?: number;
    error?: string;
  }> = [];

  for (const result of results) {
    if (result.status === "rejected") {
      comparison.push({
        merchant: "unknown",
        id: "unknown",
        name: "Error",
        price: "N/A",
        priceRaw: Infinity,
        inStock: false,
        error: result.reason.message,
      });
      continue;
    }

    const { merchantName, product } = result.value;
    comparison.push({
      merchant: merchantName,
      id: product.id,
      name: product.name,
      price: formatPrice(product.price, product.currency),
      priceRaw: product.price,
      inStock: product.inStock,
      type: product.type,
      fulfillment: product.fulfillment,
      variantCount: product.variants?.length,
    });
  }

  comparison.sort((a, b) => a.priceRaw - b.priceRaw);

  return JSON.stringify(
    {
      productsCompared: comparison.length,
      bestValue: comparison.find((c) => !c.error)?.name ?? "N/A",
      comparison,
    },
    null,
    2,
  );
}
