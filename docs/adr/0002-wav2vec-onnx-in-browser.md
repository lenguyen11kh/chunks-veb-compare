# Load wav2vec/HuBERT via ONNX in the browser despite ~90MB model size

For cross-language sound mirror matching, hand-crafted features (MFCC, LPC, spectral flux) are approximations. A model pre-trained on hundreds of thousands of hours of multilingual speech produces embeddings where acoustically similar phonemes cluster together regardless of language — exactly what sound mirror requires.

We load the model client-side via `@xenova/transformers` (WebAssembly + ONNX), keeping the app fully static with no backend. The ~90MB download is cached in the browser after first load. This is a deliberate trade-off: the initial load cost is accepted in exchange for the best available phonetic embedding quality for cross-language pairs.

## Consequences

The wav2vec method must be initialized lazily (first use triggers model download) and must show a clear loading state. It cannot be `defaultOn: true` in `METHOD_DEFS` until the model is cached.
