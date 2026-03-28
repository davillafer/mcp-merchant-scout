#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { handleDiscover } from "./tools/discover.js";
import { handleSearch } from "./tools/search.js";
import { handleGetProduct } from "./tools/product.js";
import { handleCompare } from "./tools/compare.js";

const server = new McpServer({
  name: "ucp-merchant-scout",
  version: "1.0.0",
});

// Tool 1: Discover a UCP merchant
server.tool(
  "discover_merchant",
  "Discover a UCP-enabled merchant by fetching their /.well-known/ucp profile. " +
    "Returns supported capabilities, services, and payment handlers. " +
    "The merchant is registered for subsequent search and lookup operations.",
  {
    url: z
      .string()
      .url()
      .describe("The base URL of the merchant (e.g. https://store.example.com)"),
  },
  async (args) => {
    try {
      const result = await handleDiscover(args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error discovering merchant: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 2: Search products across merchants
server.tool(
  "search_products",
  "Search for products across all discovered UCP merchants (or a specific one). " +
    "Returns matching products with prices, availability, and merchant info. " +
    "Requires at least one merchant to be discovered first.",
  {
    query: z
      .string()
      .optional()
      .describe("Search query (e.g. 'mechanical keyboard', 'coffee grinder'). Omit to list all products."),
    maxPrice: z
      .number()
      .optional()
      .describe("Maximum price filter in dollars (e.g. 150)"),
    minPrice: z
      .number()
      .optional()
      .describe("Minimum price filter in dollars (e.g. 50)"),
    merchant: z
      .string()
      .optional()
      .describe("Specific merchant URL to search (searches all if omitted)"),
    currency: z
      .string()
      .optional()
      .describe("Currency code (default: USD)"),
  },
  async (args) => {
    try {
      const result = await handleSearch(args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching products: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 3: Get full product details
server.tool(
  "get_product",
  "Get full details for a specific product from a UCP merchant, " +
    "including all variants, pricing, media, and availability.",
  {
    merchantUrl: z
      .string()
      .describe("The merchant's base URL (must be previously discovered)"),
    productId: z
      .string()
      .describe("The product ID (e.g. 'gid://shopify/Product/123')"),
  },
  async (args) => {
    try {
      const result = await handleGetProduct(args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting product: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool 4: Compare products across merchants
server.tool(
  "compare_products",
  "Compare multiple products side-by-side across merchants. " +
    "Shows pricing, availability, variants, and options for each product. " +
    "Results are sorted by lowest price.",
  {
    products: z
      .array(
        z.object({
          merchantUrl: z
            .string()
            .describe("The merchant's base URL"),
          productId: z
            .string()
            .describe("The product ID"),
        }),
      )
      .min(2)
      .max(5)
      .describe("Array of products to compare (2-5 products)"),
  },
  async (args) => {
    try {
      const result = await handleCompare(args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error comparing products: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
