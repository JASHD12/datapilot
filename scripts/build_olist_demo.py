"""Build public Olist artifacts from an explicitly supplied, local source archive."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from datapilot.public_demo import build_olist_snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("frontend/olist-snapshot.json"))
    args = parser.parse_args()
    snapshot = build_olist_snapshot(args.zip)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(snapshot, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
    args.output.write_text(encoded)
    print(json.dumps({"output": str(args.output), "bytes": len(encoded.encode()),
                      "model_cohort_rows": snapshot["profile"]["rows"],
                      "forecast_orders": snapshot["manifest"]["forecast_cohort"]["window_orders"],
                      "source": snapshot["source"]["label"]}))


if __name__ == "__main__":
    main()

