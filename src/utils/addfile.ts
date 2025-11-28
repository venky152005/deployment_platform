class Dockerfile {

static nodeDockerfile = (entrypoint: string) => `
FROM oven/bun:1
WORKDIR /app

# Copy project
COPY . .

# Install dependencies
RUN if [ -f bun.lockb ]; then \
        bun install --frozen-lockfile; \
    else \
        bun install; \
    fi

# Copy env if exists
RUN if [ -f .env ]; then cp .env /app/.env; fi

EXPOSE 3000
CMD ["bun", "${entrypoint}"]
`;


static expressDockerfile = (entrypoint: string) => `
FROM oven/bun:1
WORKDIR /app

COPY . .

RUN if [ -f bun.lockb ]; then \
        bun install --frozen-lockfile; \
    else \
        bun install; \
    fi

RUN if [ -f .env ]; then cp .env /app/.env; fi

EXPOSE 3000
CMD ["bun", "${entrypoint}"]
`;


static nextjsDockerfile = () => `
FROM oven/bun:1 AS builder
WORKDIR /app

COPY . .

RUN if [ -f bun.lockb ]; then \
        bun install --frozen-lockfile --no-progress --concurrent-jobs=2; \
    else \
        bun install --no-progress --concurrent-jobs=2; \
    fi

# Copy env to builder
RUN if [ -f .env ]; then cp .env /app/.env; fi

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_USE_TURBOPACK=1

RUN bun run build --turbo

FROM oven/bun:1 AS runner
WORKDIR /app

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.env ./.env

EXPOSE 3000
CMD ["bun", "run", "start"]
`;


static reactviteDockerfile = () => `
FROM oven/bun:1 AS builder
WORKDIR /app

COPY . .

RUN if [ -f bun.lockb ]; then \
        bun install --frozen-lockfile; \
    else \
        bun install; \
    fi

# Vite does NOT support .env inside nginx final image — only during build.
RUN if [ -f .env ]; then cp .env /app/.env; fi

RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# DO NOT expose env to browser — security risk
# (So not copying .env into nginx)

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;


static laravelDockerfile = () => `
FROM php:8.2-fpm
WORKDIR /var/www/html

COPY . .

# Copy .env if present
RUN if [ -f .env ]; then cp .env /var/www/html/.env; fi

RUN apt-get update -y && apt-get install -y libzip-dev zip unzip \
    && docker-php-ext-install pdo_mysql zip

EXPOSE 9000
CMD ["php-fpm", "-y", "/usr/local/etc/php-fpm.conf", "-O", "verbose"]
`;

}

export default Dockerfile;
