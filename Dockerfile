# Stage 1: build the React frontend
FROM node:20-alpine AS builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
COPY frontend/ ./
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build
RUN npm run build-storybook

# Stage 2: production image
FROM node:20-alpine
WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/ ./backend/
COPY schemas/ ./schemas/
COPY schema_ai_concept.md ./
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/frontend/storybook-static ./frontend/storybook-static

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001
CMD ["node", "backend/server.js"]
