FROM python:3.13-slim

WORKDIR /app

# Install poppler-utils for pdftotext fallback (optional, but good for robust PDF handling)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

# Run with Gunicorn and Uvicorn workers
CMD ["sh", "-c", "uvicorn finanalyst.server:app --host 0.0.0.0 --port ${PORT}"]
