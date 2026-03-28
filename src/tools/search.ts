import { fetchProducts, formatPrice } from "../lib/ucp-client.js";
import {
  getAllMerchants,
  getMerchant,
  type RegisteredMerchant,
} from "../lib/merchant-registry.js";

export async function handleSearch(args: {
  query?: string;
  maxPrice?: number;
  minPrice?: number;
  merchant?: string;
  currency?: string;
}): Promise<string> {
  let merchants: RegisteredMerchant[];

  if (args.merchant) {
    const m = getMerchant(args.merchant);
    if (!m) {
      return JSON.stringify({
        error: `Merchant "${args.merchant}" not found. Use discover_merchant first.`,
      });
    }
    merchants = [m];
  } else {
    merchants = getAllMerchants();
  }

  if (merchants.length === 0) {
    return JSON.stringify({
      error: "No merchants registered. Use discover_merchant first.",
    });
  }

  const results = await Promise.allSettled(
    merchants.map(async (m) => {
      const products = await fetchProducts(
        m.url,
        m.info.services,
        args.query,
        { maxPrice: args.maxPrice, minPrice: args.minPrice },
      );
      return { merchant: m, products };
    }),
  );

  const allProducts: Array<{
    merchant: string;
    merchantUrl: string;
    id: string;
    name: string;
    description: string;
    price: string;
    priceRaw: number;
    currency: string;
    inStock: boolean;
    type: string | undefined;
    imageUrl: string | undefined;
  }> = [];

  for (const result of results) {
    if (result.status === "rejected") continue;
    const { merchant, products } = result.value;

    for (const product of products) {
      allProducts.push({
        merchant: merchant.info.name,
        merchantUrl: merchant.url,
        id: product.id,
        name: product.name,
        description:
          product.description.length > 150
            ? product.description.slice(0, 150) + "..."
            : product.description,
        price: formatPrice(product.price, product.currency),
        priceRaw: product.price,
        currency: product.currency,
        inStock: product.inStock,
        type: product.type,
        imageUrl: product.imageUrl,
      });
    }
  }

  // Sort by price ascending
  allProducts.sort((a, b) => a.priceRaw - b.priceRaw);

  const failedMerchants = results.filter((r) => r.status === "rejected").length;

  return JSON.stringify(
    {
      query: args.query,
      totalResults: allProducts.length,
      merchantsSearched: merchants.length,
      merchantsFailed: failedMerchants,
      products: allProducts,
    },
    null,
    2,
  );
}
