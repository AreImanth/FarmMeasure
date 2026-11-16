# Proof-read pack — report translations

These PDFs contain the current Telugu / Tamil / Hindi report text for
native-speaker review. English (`-en`) is the reference. Map photos are grey
boxes here — only the **words and their layout** need review.

## Files

| File | Contents |
|---|---|
| `field-report-en.pdf` | Bulk report, English (reference) |
| `field-report-te.pdf` | Bulk report, Telugu |
| `field-report-ta.pdf` | Bulk report, Tamil |
| `field-report-hi.pdf` | Bulk report, Hindi (uses Bigha — UP, the Hindi-belt unit) |
| `field-report-single-en.pdf` | Single-field report, English |
| `field-report-single-te.pdf` | Single-field report, Telugu |
| `field-report-single-ta.pdf` | Single-field report, Tamil |
| `field-report-single-hi.pdf` | Single-field report, Hindi |

Sample data is identical everywhere: 3 fields (Field 3 / 5 / 7), one reporter
block, state unit Cent (Bigha-UP for Hindi). Telugu and Tamil use their
bundled Noto Sans fonts, so conjuncts, matras, and numerals should match the
on-screen UI.

The grey/“Invalid key” map tiles are expected locally because no MapTiler key
is configured; they do not affect the text being reviewed.

Regenerate this pack after changing any report string or layout:

```bash
npm run proof:pdf
```

## How to send corrections

For each fix, give: **file → page → the English line → corrected line**.
Example: `field-report-te.pdf, p1, table header "పేరు" should be "పేర్లు"`.

Anything unclear or unnatural — flag it, even if you are not sure of the
perfect word.
