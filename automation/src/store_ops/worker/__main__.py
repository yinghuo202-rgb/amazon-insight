from __future__ import annotations

import argparse
import logging
import sys

from .config import WorkerConfig
from .runner import WorkerRunner


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Measureman Commerce background worker")
    parser.add_argument("--once", action="store_true", help="Run a single poll/sync tick and exit")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    config = WorkerConfig.from_env()
    runner = WorkerRunner(config)
    if args.once:
        runner.run_tick()
        return 0

    runner.run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
