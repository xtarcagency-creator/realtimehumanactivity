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

/**
 * Fetches a URL to an ArrayBuffer, reporting real bytes-loaded progress as
 * they arrive. `expectedBytes` is used as the progress denominator whenever
 * Content-Length is missing from the response — CDNs (Vercel's included)
 * can drop it if a response gets re-compressed or re-chunked in flight,
 * which otherwise left the progress bar stuck at 0% for the whole download:
 * real bytes were arriving, but with no total to divide them by, the
 * aggregator had nothing to compute a fraction from. These are static,
 * locally-bundled files we control, so their size is known ahead of time —
 * an approximate fallback here is still an honest, close estimate, not a
 * fake timer.
 */
// If the connection itself never completes — blocked by a firewall/proxy/
// extension, a DNS hiccup, a server that accepts the connection but never
// responds — fetch()'s own promise just never settles. No bytes ever
// arrive, so no progress event ever fires, which (before this) meant the
// caller's stall watchdog had nothing to measure a stall against and never
// fired either: a genuinely silent, unbounded hang with no error and no
// Retry button. 20s is generous for an actual TTFB (real slow-but-working
// connections still get a response far under this) but bounds the case
// where nothing is ever going to arrive at all.
const CONNECT_TIMEOUT_MS = 20000

export async function fetchBuffer(
  url: string,
  key: string,
  reporter?: ProgressReporter,
  expectedBytes?: number,
): Promise<ArrayBuffer> {
  // Only the pre-headers connection phase is bounded here — the timer is
  // cleared the moment fetch() settles, so a slow-but-progressing body read
  // afterward is never touched by it (that's the caller's stall watchdog's
  // job, and it needs to allow arbitrarily slow-but-working connections).
  const connectController = new AbortController()
  const connectTimer = window.setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { signal: connectController.signal })
  } catch (err) {
    // The browser's own AbortError message ("signal is aborted without
    // reason") isn't something a user should ever see — replace it with a
    // clear, honest one specifically when this timeout caused the abort.
    if (connectController.signal.aborted) {
      throw new Error(`Timed out connecting to ${url} after ${CONNECT_TIMEOUT_MS / 1000}s.`)
    }
    throw err
  } finally {
    window.clearTimeout(connectTimer)
  }
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`)
  const totalHeader = res.headers.get('content-length')
  const total = totalHeader ? Number(totalHeader) : (expectedBytes ?? null)
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
