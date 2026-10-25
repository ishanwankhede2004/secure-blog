FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=3000 \
    DB_FILE=/data/blog.db

# The app has no dependencies, so there is nothing to install.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
