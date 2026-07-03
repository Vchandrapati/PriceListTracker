// Shared key/price normalization used by ingest and item search.
// Must stay consistent with values already stored in supplier_product.

export function normalizeKey(x: unknown): string {
    if (x == null) return "";
    let s = String(x).trim();
    if (!s) return "";
    s = s.replace(/&/g, ","); // & -> ,
    s = s.replace(/\s*,\s*/g, ","); // spaces around commas -> single comma
    s = s.replace(/\s+/g, "-"); // whitespace -> -
    s = s.replace(/-+/g, "-"); // collapse ---
    s = s.replace(/^[-,]+|[-,]+$/g, ""); // trim leading/trailing - or ,
    return s;
}

export function toPriceOrZero(x: unknown): number {
    if (x === null || x === undefined || String(x).trim() === "") return 0;
    const raw = String(x).trim();
    const poaNorm = raw.replace(/[\s.\-_/\\]+/g, "").toUpperCase();
    if (poaNorm === "POA") return 0;
    const cleaned = raw.replace(/[$,]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}
