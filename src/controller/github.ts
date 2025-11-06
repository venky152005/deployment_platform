import { Request, Response } from "express";
import simpleGit from "simple-git";
import fs from "fs";
import path from "path";
import { sendEmail } from "./email";
import { createContainer } from "./docker";

const git = simpleGit();

const nodeDockerfile = (entrypoint: string)=>`
FROM oven/bun:latest
WORKDIR /app

COPY package*.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["bun", "start"]
`

const expressDockerfile = (entrypoint: string) => `
FROM oven/bun:latest
WORKDIR /app

COPY package*.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["bun", "index.js"]
`

const nextjsDockerfile = () => `
# ⚡ Combined and optimized Next.js + Bun + Turbopack Dockerfile
FROM oven/bun:latest AS builder
WORKDIR /app

# Copy only what's needed first (better cache)
COPY package*.json bun.lockb* ./

# Install dependencies (limit jobs to avoid CPU spike)
RUN bun install --frozen-lockfile --no-progress --concurrent-jobs=2

# Copy the rest of the project
COPY . .

# Environment setup for Turbo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_USE_TURBOPACK=1
ENV TURBOPACK_THREADS=2
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Build using Bun + Turbopack
RUN bun run build --turbo

# ⚡ Final lightweight runtime image
FROM oven/bun:latest AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Copy only needed files for runtime
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
CMD ["bun", "run", "start"]
`

const reactviteDockerfile = () => `
# Use Bun base image (valid tag)
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy package files
COPY package*.json bun.lock* ./

# Install dependencies using Bun
RUN bun install --frozen-lockfile

# Copy project files
COPY . .

# Build the project
RUN bun run build

# Production stage with nginx or whatever you use
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`

const laravelDockerfile = () => `
FROM php:8.2-fpm
WORKDIR /var/www/html

# Copy project files
COPY . .

# Install required PHP extensions
RUN apt-get update -y && apt-get install -y libzip-dev zip unzip \
    && docker-php-ext-install pdo_mysql zip

# Log success
RUN echo "✅ PHP extensions installed successfully"

# Expose port
EXPOSE 9000

# Start PHP-FPM in verbose mode
CMD ["php-fpm", "-y", "/usr/local/etc/php-fpm.conf", "-O", "verbose"]
`
const getNodeEntrypoint = (packageJson:any)=>{
    if(packageJson.main)return packageJson.main;
    if(packageJson.scripts && packageJson.scripts.start){
       const match = packageJson.scripts.start.match(/node (\S+)/);
       if(match && match[1]){
          return match[1];
       }
    }
    return "index.js";
};

export const cloneRepo = async (req: Request, res: Response) => {
    const { repoUrl, projectName } = req.body;

    if (!repoUrl || !projectName) {
        return res.status(400).json({ error: "Repository URL and Project Name are required" });
    }

    try {
        await git.clone(repoUrl, `./repos/${projectName}`);

        const projectPath = path.join(__dirname, '../../repos', projectName);
        const packageJsonPath = path.join(projectPath, 'package.json');
        let packageJson : any = {};
        if (fs.existsSync(packageJsonPath)) {
            packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        }

        let dockerfileContent = '';
        let dockerignoreContent = `
            .git
            .gitignore
            Dockerfile
            *.log
        `; 

        if (packageJson.dependencies && packageJson.dependencies.next) {
            dockerfileContent = nextjsDockerfile();
            dockerignoreContent += `\nnode_modules\n.next`;
        } else if (packageJson.dependencies && packageJson.dependencies.express) {
            const entrypoint = getNodeEntrypoint(packageJson);
            dockerfileContent = expressDockerfile(entrypoint);
            dockerignoreContent += `\nnode_modules`;
        } else if (packageJson.dependencies && (packageJson.dependencies.react || packageJson.dependencies.vite)) {
           dockerfileContent = reactviteDockerfile();
           dockerignoreContent += `\nnode_modules\n.dist`;
        } else if (fs.existsSync(path.join(projectPath, 'artisan'))) {
            dockerfileContent = laravelDockerfile();
        }else{
            const entrypoint = getNodeEntrypoint(packageJson);
            dockerfileContent = nodeDockerfile(entrypoint);
            dockerignoreContent += `\nnode_modules`;
        }

        const dockerfilePath = path.join(__dirname, '../../repos', projectName, 'Dockerfile');
        if (!fs.existsSync(dockerfilePath)) {
            fs.writeFileSync(dockerfilePath, dockerfileContent);
            console.log(`Dockerfile created at ${dockerfilePath}`);
        }

        const dockerignorefilePath = path.join(__dirname, '../../repos', projectName, '.dockerignore');
        if (!fs.existsSync(dockerignorefilePath)) {
            fs.writeFileSync(dockerignorefilePath, dockerignoreContent);
            console.log(`Dockerignorefile created at ${dockerignorefilePath}`);
        }

        await createContainer({
            body: {
                projectPath: projectPath,
                projectName: projectName
            }
        } as Request, res);

    try{
       fs.rmSync(projectPath,{ recursive: true, force: true });
       console.log(`✅ Deleted cloned repo: ${projectPath}`);
       }catch(err){
       console.error(`⚠️ Failed to delete ${projectPath}:`, err);
       }
    } catch (error) {
        console.error("Error cloning repository:", error);
        sendEmail('venky15.12.2005@gmail.com','Error Occured While Git Access',`There was an error creating the project ${projectName} located at ${repoUrl}. Please check the logs for more details.`)
        res.status(500).json({ error: "Failed to clone repository" });
    }
};
