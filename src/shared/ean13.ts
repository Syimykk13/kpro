export function generateInternalEan13(accountId: string, existingBarcodes: string[]) {
  const numericSeed = accountId
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0)
    .toString()
    .padStart(3, "0")
    .slice(-3);

  for (let index = existingBarcodes.length + 1; index < 9999999; index += 1) {
    const base = `20${numericSeed}${String(index).padStart(7, "0")}`.slice(0, 12);
    const barcode = `${base}${ean13Checksum(base)}`;
    if (!existingBarcodes.includes(barcode)) {
      return barcode;
    }
  }

  throw new Error("Не удалось сгенерировать внутренний штрихкод.");
}

export function isValidEan13(value: string) {
  const normalized = value.replace(/\D/g, "");
  if (normalized.length !== 13) {
    return false;
  }
  return ean13Checksum(normalized.slice(0, 12)) === Number(normalized[12]);
}

function ean13Checksum(base12: string) {
  const sum = base12
    .split("")
    .map(Number)
    .reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}
