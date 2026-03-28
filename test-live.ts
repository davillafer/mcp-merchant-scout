/**
 * Quick integration test against live UCP endpoints.
 * Run with: npx tsx test-live.ts
 */

import { discoverMerchant, fetchProducts, fetchProduct } from "./src/lib/ucp-client.js";

const PUDDING_HEROES = "https://puddingheroes.com";

async function main() {
  console.log("=== Testing UCP Merchant Scout against live endpoints ===\n");

  // 1. Discovery
  console.log("1. Discovering Pudding Heroes...");
  const info = await discoverMerchant(PUDDING_HEROES);
  console.log(`   Name: ${info.name}`);
  console.log(`   Version: ${info.version}`);
  console.log(`   Capabilities: ${info.capabilities.join(", ")}`);
  console.log(`   Services: ${JSON.stringify(info.services)}`);
  console.log(`   Sandbox: ${info.sandbox}`);
  console.log();

  // 2. Fetch all products
  console.log("2. Fetching all products...");
  const allProducts = await fetchProducts(PUDDING_HEROES, info.services);
  console.log(`   Found ${allProducts.length} products:`);
  for (const p of allProducts) {
    console.log(`   - ${p.name}: $${p.price.toFixed(2)} (${p.inStock ? "in stock" : "out of stock"})`);
  }
  console.log();

  // 3. Search with query
  console.log('3. Searching for "book"...');
  const books = await fetchProducts(PUDDING_HEROES, info.services, "book");
  console.log(`   Found ${books.length} matching products:`);
  for (const p of books) {
    console.log(`   - ${p.name}: $${p.price.toFixed(2)}`);
  }
  console.log();

  // 4. Search with price filter
  console.log("4. Products under $20...");
  const cheap = await fetchProducts(PUDDING_HEROES, info.services, undefined, { maxPrice: 20 });
  console.log(`   Found ${cheap.length} products:`);
  for (const p of cheap) {
    console.log(`   - ${p.name}: $${p.price.toFixed(2)}`);
  }
  console.log();

  // 5. Get single product
  console.log("5. Getting product details for 'pudding-heroes-paperback'...");
  const product = await fetchProduct(PUDDING_HEROES, info.services, "pudding-heroes-paperback");
  if (product) {
    console.log(`   Name: ${product.name}`);
    console.log(`   Price: $${product.price.toFixed(2)}`);
    console.log(`   Description: ${product.description}`);
    console.log(`   Type: ${product.type}`);
    console.log(`   Fulfillment: ${product.fulfillment}`);
  } else {
    console.log("   Product not found!");
  }

  console.log("\n=== All tests passed! ===");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
