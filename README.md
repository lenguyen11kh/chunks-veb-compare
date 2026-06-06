# CHUNKS Audio Similarity Analyzer

Static browser app for comparing two audio clips using acoustic feature analysis. Audio processing runs locally in the browser.

## Features

- Upload or record Audio A / Audio B
- Optional preprocessing: normalize loudness, trim silence
- Signal-based methods: MFCC + DTW, formants, Mel spectrogram, pitch contour, raw cross-correlation
- Export JSON results
- LLM Settings page for 9Router/OpenAI-compatible result explanation

## Run locally

```bash
python -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/

## LLM Settings

Open **LLM Settings** in the app and configure:

- API endpoint: e.g. `http://localhost:20128`
- API key: optional, if 9Router requires auth
- Model ID: load from `/v1/models` or enter manually, e.g. `openai/gpt-5`

The app calls:

- `GET <endpoint>/v1/models`
- `POST <endpoint>/v1/chat/completions`

API key is stored only in browser `localStorage`; it is not committed to this repo.

## Vercel

This is a static site. `vercel.json` is included for clean URLs and basic security/cache headers.

Recommended release flow:

1. Commit changes.
2. Tag a release before production deploy.
3. Deploy preview first on Vercel.
4. Validate analyzer, guide page, LLM settings, model test, and JSON AI analysis.
5. Promote to production.
6. Rollback by redeploying the previous Vercel deployment or checking out the previous Git tag.

Note: Vercel default domains are usually `*.vercel.app`. A `*.web.app` domain is typically Firebase Hosting-managed unless separately owned/configured as a custom domain.
