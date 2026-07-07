# Acorn Communicate — reference deployment image
FROM node:22-alpine AS base
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY assets ./assets

ENV NODE_ENV=production \
    PORT=4000 \
    ACORN_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1

USER node
CMD ["npx", "tsx", "src/index.ts"]
