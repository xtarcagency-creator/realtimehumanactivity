// Real byte-level progress for model downloads, used to drive the loading
// progress bar. Plain `fetch` + `ReadableStream` reads instead of relying on
// any library's own loader, since neither ONNX Runtime Web's session
// creation nor tfjs-models' modelUrl loading exposes download progress —
// this reads the response body ourselves (and for MoveNet, primes the
// browser's HTTP cache so the library's own subsequent fetch of the same
// URL resolves instantly instead of re-downloading).

export interface ProgressReporter {
  report(key: string, deltaBytes: number, totalBytes: number | null): void
}

/**
 * Combines byte progress across an arbitrary set of concurrent downloads
 * (keyed by name) into one 0-1 fraction, weighted by each file's actual
 * size once known. Clamped below 1 until the caller explicitly finishes —
 * a file with no Content-Length, or one skipped because it's already
 * cached, would otherwise leave the denominator short of the real total.
 */
export function createProgressAggregator(onFraction: (fraction: number) => void): ProgressReporter {
  const totals = new Map<string, number>()
  let knownTotal = 0
  let sumLoaded = 0
  return {
    report(key, deltaBytes, totalBytes) {
      if (totalBytes != null && !totals.has(key)) {
        totals.set(key, totalBytes)
        knownTotal += totalBytes
      }
      sumLoaded += deltaBytes
      onFraction(knownTotal > 0 ? Math.min(0.99, sumLoaded / knownTotal) : 0)
    },
  }
}

/** Fetches a URL to an ArrayBuffer, reporting real bytes-loaded progress as they arrive. */
export async function fetchBuffer(url: string, key: string, reporter?: ProgressReporter): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`)
  const totalHeader = res.headers.get('content-length')
  const total = totalHeader ? Number(totalHeader) : null
  const reader = res.body?.getReader()
  if (!reader) {
    // Streaming reads aren't available (older browser, or a response the
    // engine already buffered) — fall back to an all-at-once read with a
    // single progress jump instead of granular chunks.
    const buf = await res.arrayBuffer()
    reporter?.report(key, buf.byteLength, total ?? buf.byteLength)
    return buf
  }
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    reporter?.report(key, value.byteLength, total)
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer
}
