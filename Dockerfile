FROM node:22 AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npx vite build
# Bundle MCP server into a single JS file for Node.js in the final image.
# better-sqlite3 is external because it has native bindings that can't be bundled.
RUN npx esbuild src/mcp/server.ts --bundle --platform=node --outfile=build/mcp/server.js \
    --external:better-sqlite3 --format=esm
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

# Install Codex CLI globally (optional model provider)
RUN npm install -g @openai/codex

RUN useradd -m -s /bin/bash deepwiki && \
    mkdir -p /home/deepwiki/app/data /home/deepwiki/.codex && \
    chown -R deepwiki:deepwiki /home/deepwiki/app /home/deepwiki/.codex
USER deepwiki
WORKDIR /home/deepwiki/app

# Install Claude CLI (native installer)
RUN curl -fsSL https://claude.ai/install.sh | bash -s stable
ENV PATH="/home/deepwiki/.local/bin:$PATH"

COPY --from=build --chown=deepwiki:deepwiki /app/build ./build
COPY --from=build --chown=deepwiki:deepwiki /app/node_modules ./node_modules
COPY --from=build --chown=deepwiki:deepwiki /app/package.json ./
COPY --from=build --chown=deepwiki:deepwiki /app/src/lib/server/db/schema.sql ./build/server/chunks/schema.sql

COPY --chown=deepwiki:deepwiki docker/claude-settings.json /opt/claude-defaults/settings.json
COPY --chown=deepwiki:deepwiki docker/entrypoint.sh /opt/claude-defaults/entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
EXPOSE 3001

ENTRYPOINT ["/opt/claude-defaults/entrypoint.sh"]
CMD ["node", "build/index.js"]
