"""Run the real-font suite and print one JSON object per test result on stdout (JSON lines).

    uv run python tests/font/run.py [-k SUBSTRING ...]

Each line is {"id", "status", "message", "seconds"}, with status one of pass, fail, error,
skip, expected_failure, unexpected_success. Nothing else goes to stdout; the human summary
is on stderr. The exit code is 1 if anything failed or errored, or if no test ran, else 0.

Unlike a plain `python -m unittest discover -s tests/font`, which skips when build/Font.ttf
is missing, this runner sets REQUIRE_REAL_FONT=1 so a missing font is a failure: a tool
reading the output must never mistake "tested nothing" for "all good".
"""

import json
import os
import sys
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class JsonLinesResult(unittest.TestResult):
    def __init__(self, stream):
        super().__init__()
        self.stream = stream
        self.counts: dict[str, int] = {}
        self._started = 0.0

    def emit(self, test, status, message=""):
        self.counts[status] = self.counts.get(status, 0) + 1
        record = {"id": test.id(), "status": status, "message": message,
                  "seconds": round(time.perf_counter() - self._started, 4)}
        self.stream.write(json.dumps(record) + "\n")
        self.stream.flush()

    def startTest(self, test):
        super().startTest(test)
        self._started = time.perf_counter()

    def addSuccess(self, test):
        super().addSuccess(test)
        self.emit(test, "pass")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.emit(test, "fail", self.failures[-1][1])

    def addError(self, test, err):
        super().addError(test, err)
        self.emit(test, "error", self.errors[-1][1])

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.emit(test, "skip", reason)

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self.emit(test, "expected_failure")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self.emit(test, "unexpected_success")


def _flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _flatten(item)
        else:
            yield item


def main(argv: list[str]) -> int:
    os.environ["REQUIRE_REAL_FONT"] = "1"
    sys.path.insert(0, str(HERE))
    patterns = [argv[i + 1] for i, a in enumerate(argv[:-1]) if a == "-k"]
    suite = unittest.defaultTestLoader.discover(str(HERE), pattern="test_*.py")
    if patterns:
        suite = unittest.TestSuite(t for t in _flatten(suite)
                                   if any(p in t.id() for p in patterns))
    result = JsonLinesResult(sys.stdout)
    suite.run(result)
    summary = ", ".join(f"{n} {s}" for s, n in sorted(result.counts.items())) or "no tests ran"
    print(f"tests/font: {summary}", file=sys.stderr)
    return 0 if result.wasSuccessful() and result.testsRun else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
