#!/bin/sh
# Create the pipeline virtualenv (Python >= 3.11) and install its requirements.
set -e
cd "$(dirname "$0")/../pipeline"
if [ ! -x .venv/bin/python ]; then
  PY=$(command -v python3.14 || command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3)
  "$PY" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required"'
  "$PY" -m venv .venv
fi
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
echo "pipeline virtualenv ready: $(.venv/bin/python --version)"
