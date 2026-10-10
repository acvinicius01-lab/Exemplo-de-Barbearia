FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/reservas.sqlite
WORKDIR /app
COPY --chown=node:node package.json server.mjs database.mjs services.mjs admin-auth.mjs api-client.mjs backups.mjs ./
COPY --chown=node:node scripts/backup.mjs ./scripts/
COPY --chown=node:node index.html styles.css app.js admin.html admin.css admin.js ./
COPY --chown=node:node assets/brand.svg assets/barber-art.svg ./assets/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
