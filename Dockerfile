FROM node:22-bookworm-slim

WORKDIR /app

# Required for native Node module builds (better-sqlite3 on arm64/node22).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

ENV NODE_ENV=production
EXPOSE 3737

CMD ["node", "server.js"]
