type ProductLookupResponse = {
  status?: number;
  product?: {
    product_name?: unknown;
    product_name_en?: unknown;
    product_name_ja?: unknown;
    generic_name?: unknown;
    generic_name_en?: unknown;
    generic_name_ja?: unknown;
    brands?: unknown;
  };
};

export type ProductNameLookupResult = {
  name: string;
  brandOnly: boolean;
};

function firstName(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export async function lookupFoodProductName(
  barcode: string,
): Promise<ProductNameLookupResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name_ja,product_name,product_name_en,generic_name_ja,generic_name,generic_name_en,brands`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Langapp mobile application',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Product lookup failed with HTTP ${response.status}.`);
    }
    const result = (await response.json()) as ProductLookupResponse;
    if (result.status !== 1 || !result.product) return null;
    const name = firstName(
      result.product.product_name_ja,
      result.product.product_name,
      result.product.product_name_en,
      result.product.generic_name_ja,
      result.product.generic_name,
      result.product.generic_name_en,
    );
    if (name) return { name, brandOnly: false };
    const brand = firstName(result.product.brands);
    return brand ? { name: brand.split(',')[0].trim(), brandOnly: true } : null;
  } finally {
    clearTimeout(timeout);
  }
}
