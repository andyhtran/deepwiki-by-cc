FROM node:22 AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npx vite build
RUN rm -rf node_modules && npm install --omit=dev

FROM node:22-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl unzip ca-certificates && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash deepwiki && \
    mkdir -p /home/deepwiki/app/data && \
    chown -R deepwiki:deepwiki /home/deepwiki/app
USER deepwiki
WORKDIR /home/deepwiki/app

# Install Claude CLI (native installer)
RUN curl -fsSL https://claude.ai/install.sh | bash -s stable
ENV PATH="/home/deepwiki/.local/bin:$PATH"

COPY --from=build --chown=deepwiki:deepwiki /app/build ./build
COPY --from=build --chown=deepwiki:deepwiki /app/node_modules ./node_modules
COPY --from=build --chown=deepwiki:deepwiki /app/package.json ./
COPY --from=build --chown=deepwiki:deepwiki /app/src/lib/server/db/schema.sql ./build/server/chunks/schema.sql

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "build/index.js"]
