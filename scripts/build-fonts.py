#!/usr/bin/env python3
"""build-fonts.py — rebuild the vendored Noto Sans fonts for FarmMeasure.

The app ships *static, subset* Noto Sans faces (SIL Open Font License) for the
three Indic languages it supports. Subsetting keeps each file small enough for
offline/mobile use while retaining the OpenType shaping tables (akhn, rphf,
half, pres, abvs, psts, ...) so browsers render conjuncts and matras correctly.

The same TTFs are used by:
  - css/styles.css  (@font-face for the UI, loaded only for the active lang)
  - js/pdf.js       (canvas text renderer for reports — the browser shapes the
                     text, then the PNG is embedded in the PDF, so Telugu /
                     Tamil / Hindi conjuncts are visually correct)

Usage (needs `pip install fonttools brotli`):

    python scripts/build-fonts.py

Sources come from the google/fonts repository (variable fonts); this script
pins static Regular (400) and Bold (700) instances, subsets them and writes
fonts/NotoSans*-Regular.ttf / -Bold.ttf.
"""
from __future__ import annotations

import io
import pathlib
import sys
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset
from fontTools.subset import parse_unicodes

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "fonts"

# Google Fonts variable-font sources (OFL-1.1).
SOURCES = {
    "Devanagari": "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf",
    "Telugu": "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstelugu/NotoSansTelugu%5Bwdth,wght%5D.ttf",
    "Tamil": "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstamil/NotoSansTamil%5Bwdth,wght%5D.ttf",
}

# Latin + punctuation (numbers, unit symbols, bullets, quotes, ©, ₹) and the
# language's own Unicode block. Keep this list conservative: every extra block
# makes the offline download bigger.
COMMON_UNICODES = [
    "U+0000-00FF",   # Basic Latin + Latin-1 (digits, m², ×, ©, °)
    "U+2000-206F",   # General punctuation (— – ‘ ’ “ ” … · ZWNJ/ZWJ)
    "U+20B9",        # Indian rupee sign
    "U+2122",        # trade mark
]

SCRIPT_BLOCKS = {
    "Devanagari": "U+0900-097F",
    "Telugu": "U+0C00-0C7F",
    "Tamil": "U+0B80-0BFF",
}


def download(url: str) -> bytes:
    print(f"  downloading {url.split('/')[-1]} …")
    with urllib.request.urlopen(url, timeout=120) as res:
        return res.read()


def build(script: str, url: str) -> None:
    raw = download(url)
    axes = {"wght": 400, "wdth": 100}
    for weight, suffix in ((400, "Regular"), (700, "Bold")):
        axes["wght"] = weight
        font = TTFont(io.BytesIO(raw))
        if "fvar" in font:
            font = instantiateVariableFont(font, axes, updateFontNames=True)

        unicodes = parse_unicodes(",".join(COMMON_UNICODES + [SCRIPT_BLOCKS[script]]))
        options = subset.Options()
        options.layout_features = ["*"]      # keep Indic shaping features
        options.name_IDs = ["*"]
        options.name_legacy = True
        options.notdef_outline = True
        options.recalc_bounds = True
        options.drop_tables += ["DSIG"]
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=unicodes)
        subsetter.subset(font)

        out = FONT_DIR / f"NotoSans{script}-{suffix}.ttf"
        font.save(out)
        print(f"  wrote {out.relative_to(ROOT)}  ({out.stat().st_size / 1024:.0f} KB)")


def main() -> int:
    FONT_DIR.mkdir(exist_ok=True)
    for script, url in SOURCES.items():
        print(f"{script}:")
        build(script, url)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
