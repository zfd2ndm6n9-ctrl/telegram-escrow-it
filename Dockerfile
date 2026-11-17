FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Branding foto gruppi deal (setChatPhoto su /avvia).
COPY assets ./assets
# Mini App Termini (GET /tos).
COPY public ./public
# Persistenza deal: monta un volume persistente su /app/data (o imposta DATA_DIR).
# Su Render blueprint: disk → /var/data e DATA_DIR=/var/data.
RUN mkdir -p /app/data /var/data
EXPOSE 8080
ENV PORT=8080
ENV DATA_DIR=/app/data
CMD ["node", "dist/index.js"]
