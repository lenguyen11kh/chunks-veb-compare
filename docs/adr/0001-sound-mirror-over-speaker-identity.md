# Sound mirror as the primary comparison goal, not speaker identity

The app's `analysisGoal` state defaults to `same-speaker`, and the existing method set (MFCC, formants, pitch, raw correlation) was assembled without a single declared purpose. After clarifying the intended use — comparing whether two audio clips produce similar acoustic/phonetic shapes regardless of language or speaker — we re-oriented the app around the **sound mirror** goal.

This means: pitch contour and raw cross-correlation are the wrong layer (they measure intonation and waveform identity, not phonetic shape), formants only cover vowels, and MFCC + DTW is the only currently correct method. New methods (MFCC-39, LPC, voiced/unvoiced rhythm, spectral flux, wav2vec) were chosen specifically because they measure vocal tract shape and phoneme transitions in a language-agnostic way.

## Considered options

**Speaker identity** — keep the `same-speaker` framing, optimize for voice biometrics. Rejected: the explicit requirement is cross-language phonetic matching ("I'll go there" ≈ "úm um ùm"), which speaker-identity methods handle poorly.

**Semantic similarity** — compare meaning across clips. Rejected: requires speech-to-text and language models; incompatible with the browser-only constraint and the language-agnostic requirement.
