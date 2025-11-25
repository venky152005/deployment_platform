class Dockerfile {

static nodeDockerfile = (entrypoint: string) => `
FROM oven/bun:latest
WORKDIR /app

ARG USE_FROZEN=false

COPY package*.json ./
COPY bun.lockb* ./ 2>/dev/null || true

RUN if [ "$USE_FROZEN" = "true" ] ; then \
        bun install --frozen-lockfile ; \
    else \
        bun install ; \
    fi

COPY . .

EXPOSE 3000
CMD ["bun", "${entrypoint}"]
`;

static expressDockerfile = (entrypoint: string) => `
FROM oven/bun:latest
WORKDIR /app

ARG USE_FROZEN=false

COPY package*.json ./
COPY bun.lockb* ./ 2>/dev/null || true

RUN if [ "$USE_FROZEN" = "true" ] ; then \
        bun install --frozen-lockfile ; \
    else \
        bun install ; \
    fi

COPY . .

EXPOSE 3000
CMD ["bun", "${entrypoint}"]
`;

static nextjsDockerfile = () => `
FROM oven/bun:latest AS builder
WORKDIR /app

ARG USE_FROZEN=false

COPY package*.json ./
COPY bun.lockb* ./ 2>/dev/null || true

RUN if [ "$USE_FROZEN" = "true" ] ; then \
        bun install --frozen-lockfile --no-progress --concurrent-jobs=2 ; \
    else \
        bun install --no-progress --concurrent-jobs=2 ; \
    fi

COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_USE_TURBOPACK=1
ENV TURBOPACK_THREADS=2

RUN bun run build --turbo

FROM oven/bun:latest AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
CMD ["bun", "run", "start"]
`;

static reactviteDockerfile = () => `
FROM oven/bun:1 AS builder
WORKDIR /app

ARG USE_FROZEN=false

# Copy dependency files (safe wildcard)
COPY package*.json bun.lockb* ./

# Install dependencies
RUN if [ "$USE_FROZEN" = "true" ] ; then \
        bun install --frozen-lockfile ; \
    else \
        bun install ; \
    fi

# Copy the rest of the project
COPY . .

# Build Vite app
RUN bun run build

# Final nginx server
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;


static laravelDockerfile = () => `
FROM php:8.2-fpm
WORKDIR /var/www/html

COPY . .

RUN apt-get update -y && apt-get install -y libzip-dev zip unzip \
    && docker-php-ext-install pdo_mysql zip

EXPOSE 9000
CMD ["php-fpm", "-y", "/usr/local/etc/php-fpm.conf", "-O", "verbose"]
`;

}

export default Dockerfile;

