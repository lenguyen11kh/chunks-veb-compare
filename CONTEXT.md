# CHUNKS Audio Similarity Analyzer

A static browser app that measures how acoustically similar two audio clips are — not what was said, not who said it, only the sound shapes themselves.

## Language

### Core purpose

**Sound Mirror**:
The acoustic/phonetic similarity between two audio clips regardless of language, speaker, or meaning. Two clips are a strong sound mirror if the sequence of mouth-shapes and vocal tract configurations they produce is similar — "I'll go there" (English) can mirror "úm um ùm" (Vietnamese) if their phoneme sequences overlap acoustically.
_Avoid_: audio similarity (too broad — could mean timbre, speaker, melody), phoneme matching (too narrow — implies language-aware decoding)

**Analysis Pair**:
The two audio clips (A and B) loaded into the analyzer for a single comparison run.
_Avoid_: audio inputs, clips, samples

### Methods

**Method**:
One algorithm that takes an Analysis Pair and produces a Score (0–100) representing sound mirror strength. Each method measures a different acoustic dimension.
_Avoid_: algorithm, analyzer, feature

**Score**:
A 0–100 number produced by a Method for a given Analysis Pair. Higher = more similar by that method's measure.
_Avoid_: similarity, result, value

**Method Performance**:
The Spearman rank correlation between a Method's Scores and the user's Verdicts across all labeled History Entries. High performance means the method's rankings agree with the user's ear.
_Avoid_: accuracy, precision, method score

### Evaluation

**Verdict** (`humanVerdict`):
The user's 4-point label on a History Entry: `very-similar`, `similar`, `different`, or `very-different`. Represents how strongly the user's ear judges the pair to be a sound mirror.
_Avoid_: label, rating, review score, tag

**Method Label** (`methodLabels`):
A per-method assessment within a History Entry marking whether a specific Method's Score agreed with the user's ear for that pair. Distinct from Verdict (which is the overall pair judgment).
_Avoid_: method verdict, method review

**History Entry**:
A saved record of one Analysis Pair run, including audio blobs, all Method Scores, the Verdict, and Method Labels.
_Avoid_: analysis record, log entry, saved analysis

**Method Performance Panel**:
A panel in the History page that computes and displays Method Performance across all labeled History Entries. Visible once ≥5 Verdicts have been assigned.
_Avoid_: analytics dashboard, method comparison view

### Flagged ambiguities

**"Similar"** is overloaded. In this codebase it appears as:
- A general adjective ("audio similarity analyzer") — referring to sound mirror
- `similar` — one of the four Verdict values
- `simLabel()` — a score label string ("Very similar", "Quite similar") used in Method output

These are three different concepts. The canonical project-level term is **sound mirror**. `similar` is a Verdict value. `simLabel` output strings are display labels only — do not treat them as domain terms.

## Example dialogue

> Dev: "So the Score is just whether two clips sound similar?"
>
> Domain: "Not 'similar' in a general sense — specifically whether they're a sound mirror. Pitch, words, speaker — none of that matters. Only the acoustic shape of the sounds produced."
>
> Dev: "If I label a pair with Verdict `similar`, does that mean the Method's Score should be high?"
>
> Domain: "Exactly. Method Performance tells you which Method's Scores correlate best with your Verdicts. If wav2vec consistently scores high on pairs you labeled `very-similar`, it has high Method Performance."
>
> Dev: "What's a Method Label for?"
>
> Domain: "It's different from Verdict. Verdict is your judgment of the pair. A Method Label is you saying 'this specific Method got it wrong on this entry' — for later debugging, not for the performance calculation."
