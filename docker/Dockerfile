FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data
EXPOSE 4000
CMD ["node", "dist/server/index.js"]
