FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

# Serve with gunicorn, not the Werkzeug development server that
# `python app.py` starts -- that server is single-process, explicitly not
# meant for production, and was a real source of latency under concurrency.
#
# Exactly ONE worker on purpose: flask-limiter is configured with
# `storage_uri="memory://"`, so each additional worker process would keep
# its own private counter and the effective rate limit would silently
# become workers x limit. Concurrency comes from threads instead.
CMD gunicorn --bind 0.0.0.0:${PORT:-8001} --workers 1 --threads 8 --timeout 60 app:app
