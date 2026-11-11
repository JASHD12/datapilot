"""Check the published research reports without raw data or model downloads."""
import json
from pathlib import Path

from datapilot.research_validation import validate_research_directory

if __name__ == "__main__":
    print(json.dumps({"research_checked": True, **validate_research_directory(Path(__file__).resolve().parents[1])}))
