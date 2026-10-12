FROM node:24-bookworm-slim

# Garmin SDK files are downloaded privately after accepting its agreement.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    INSTINCTUAL_FACE_CONTAINER=1
WORKDIR /app

COPY --chown=node:node server.mjs compiler.mjs templates.mjs package.json ./
COPY --chown=node:node web ./web
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
