// Vectors are stored as int8 with one float scale per vector (about 4x smaller than float32, same ranking).
export function quantize(v: Float32Array | number[]): { q: Int8Array; scale: number } {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
  const scale = max / 127 || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] / scale)));
  return { q, scale };
}

/** Dot product of a float query with stored int8 row `row` of `mat` (dims wide). */
export function dotInt8(query: Float32Array, mat: Int8Array, row: number, dims: number, scale: number): number {
  let s = 0;
  const off = row * dims;
  for (let i = 0; i < dims; i++) s += query[i] * mat[off + i];
  return s * scale;
}

/** index.bin layout: "WKB1", u32 count, u32 dims, int8[count*dims], f32[count]. */
export function encodeIndex(rows: { q: Int8Array; scale: number }[], dims: number): Uint8Array {
  const n = rows.length;
  const buf = new ArrayBuffer(12 + n * dims + ((4 - ((12 + n * dims) % 4)) % 4) + n * 4);
  const view = new DataView(buf);
  [0x57, 0x4b, 0x42, 0x31].forEach((b, i) => view.setUint8(i, b));
  view.setUint32(4, n, true);
  view.setUint32(8, dims, true);
  const mat = new Int8Array(buf, 12, n * dims);
  rows.forEach((r, i) => mat.set(r.q, i * dims));
  const scalesOff = 12 + n * dims + ((4 - ((12 + n * dims) % 4)) % 4);
  const scales = new Float32Array(buf, scalesOff, n);
  rows.forEach((r, i) => (scales[i] = r.scale));
  return new Uint8Array(buf);
}

export function decodeIndex(bytes: ArrayBuffer): { count: number; dims: number; mat: Int8Array; scales: Float32Array } {
  const view = new DataView(bytes);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "WKB1") throw new Error("Not a Wisp knowledge index.");
  const count = view.getUint32(4, true);
  const dims = view.getUint32(8, true);
  const mat = new Int8Array(bytes, 12, count * dims);
  const scalesOff = 12 + count * dims + ((4 - ((12 + count * dims) % 4)) % 4);
  return { count, dims, mat, scales: new Float32Array(bytes, scalesOff, count) };
}
