"""Test package marker.

`python -m unittest discover -s tests -t .` sets the top-level directory to
Walmart/ and then imports the start directory as a package relative to it.
Without this file that import fails with "Start directory is not importable".

Making it a package also means Walmart/ is the top-level on sys.path during
discovery, so `from Middlewares.client_identity import ...` resolves the same
way it does when app.py runs.

Test-only: it is not imported by the application, and `requirements.txt` is
untouched, so nothing here reaches the Cloud Run image's dependency set.
"""
