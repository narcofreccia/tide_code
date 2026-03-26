#!/usr/bin/env bash
# HookMaster — Block Stop Until Tests Pass
# Event: Stop | Can Block: YES (exit 2 forces Claude to continue)

set -euo pipefail

# Detect test runner
if [ -f "package.json" ]; then
  if jq -e '.scripts.test' package.json &>/dev/null; then
    TEST_CMD="npm test -- --passWithNoTests 2>&1"
  else
    exit 0  # No test script defined
  fi
elif [ -f "pytest.ini" ] || [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  TEST_CMD="python -m pytest --tb=short -q 2>&1"
elif [ -f "Cargo.toml" ]; then
  TEST_CMD="cargo test 2>&1"
else
  exit 0  # Unknown project type
fi

RESULT=$(eval "$TEST_CMD" || true)
EXIT_CODE=${PIPESTATUS[0]:-$?}

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "❌ HookMaster: Tests are failing. Claude must fix them before completing." >&2
  echo "$RESULT" | tail -15 >&2
  exit 2  # Exit code 2 = block the Stop, force Claude to continue
fi

exit 0
