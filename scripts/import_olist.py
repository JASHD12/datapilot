#!/usr/bin/env python3
"""Convert an already downloaded official Olist ZIP; no credentials or network."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from datapilot.olist import load_olist_zip


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, required=True, help="Downloaded official Olist archive")
    parser.add_argument("--output", type=Path, default=Path("data/raw/olist_orders.csv"))
    parser.add_argument("--max-rows", type=int, default=None, help="Optional documented sample size")
    args = parser.parse_args()
    frame = load_olist_zip(args.zip, max_rows=args.max_rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.output, index=False)
    metadata_path = args.output.with_suffix(".metadata.json")
    metadata_path.write_text(json.dumps(frame.attrs["metadata"], indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(args.output), "metadata": str(metadata_path), "rows": len(frame),
                      "source": frame.attrs["metadata"]["label"], "sampled": frame.attrs["metadata"]["sampled"]}))


if __name__ == "__main__":
    main()

