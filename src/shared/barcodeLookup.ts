import productBarcodeCatalog from "./productBarcodeCatalog.json";

export type BarcodeLookupResult = {
  barcode: string;
  name: string;
  unit?: string;
  purchasePrice?: number;
  salePrice?: number;
  categoryHint?: string;
};

const barcodeDirectory = productBarcodeCatalog as Record<string, string>;

export function normalizeBarcode(value: string) {
  return value.trim().replace(/\s+/g, "").replace(/[^0-9A-Za-z_-]/g, "");
}

export function lookupProductByBarcode(barcode: string): BarcodeLookupResult | null {
  const normalized = normalizeBarcode(barcode);
  const name = barcodeDirectory[normalized];
  return name ? { barcode: normalized, name } : null;
}
