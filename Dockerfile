FROM node:20-slim

# Playwright needs system libraries for Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Install only Chromium for Playwright
RUN npx playwright install --with-deps chromium

COPY src/ ./src/

CMD ["sh", "-c", "node src/daily-run.js && node src/qc.js"]
