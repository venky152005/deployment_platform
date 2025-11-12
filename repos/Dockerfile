
FROM jit_backend:1762463798440

WORKDIR /app

COPY . .
COPY .env /app/.env

EXPOSE 8000

ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]
