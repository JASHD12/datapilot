from __future__ import annotations

import argparse


def main():
    parser = argparse.ArgumentParser(description="DataPilot local ML workbench")
    subcommands = parser.add_subparsers(dest="command", required=True)
    serve = subcommands.add_parser("serve", help="Start the single-user local API and frontend")
    serve.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.command == "serve":
        import uvicorn
        uvicorn.run("datapilot.api:create_app", factory=True, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()

