FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend ./

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    CAMOUFOX_HEADLESS=true

RUN mkdir -p /app/data/screenshots

EXPOSE 3001

CMD ["npm", "start"]
