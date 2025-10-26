import { Request, Response } from "express";
import simpleGit from "simple-git";
import fs from "fs";
import path from "path";
import { sendEmail } from "./email";
import { createContainer } from "./docker";

const git = simpleGit();

const nodeDockerfile = (entrypoint: string) => `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "${entrypoint}"]
`

const expressDockerfile = (entrypoint: string) => `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "${entrypoint}"]
`

const nextjsDockerfile = () => `
# ---------- Build Stage ----------
FROM node:18-alpine AS builder
WORKDIR /app

# Copy only package.json first to install dependencies
COPY package*.json ./
RUN npm install

# Copy project files
COPY . .

# Fix Next.js permission issue
RUN chmod -R +x node_modules/.bin

# Build the Next.js app
RUN npm run build

# ---------- Production Stage ----------
FROM node:18-alpine
WORKDIR /app

# Copy only necessary files from builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

# Set environment variable
ENV NODE_ENV production

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
`

const reactviteDockerfile = () => `
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`

const laravelDockerfile = () => `
FROM php:8.2-fpm
WORKDIR /var/www/html
COPY . .
RUN apt-get update && apt-get install -y libzip-dev zip unzip \\
    && docker-php-ext-install pdo_mysql zip
EXPOSE 9000
CMD ["php-fpm"]
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
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
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

        await sendEmail("venky15.12.2005@gmail.com",`Repository ${projectName} Cloned`, `The repository ${repoUrl} has been successfully cloned to ./repos/${projectName}`);
        
        await createContainer({
            body: {
                projectPath: projectPath,
                projectName: projectName
            }
        } as Request, res);
    } catch (error) {
        console.error("Error cloning repository:", error);
        res.status(500).json({ error: "Failed to clone repository" });
    }
};