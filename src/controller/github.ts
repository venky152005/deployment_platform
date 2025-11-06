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
RUN npm install --verbose
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`

const expressDockerfile = (entrypoint: string) => `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --verbose
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
`

const nextjsDockerfile = () => `
# ---------- Build Stage ----------
FROM node:18-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install --verbose
COPY . .

RUN chmod -R +x node_modules/.bin

RUN npm run build --verbose

# ---------- Production Stage ----------
FROM node:18-alpine
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV production

EXPOSE 3000
CMD ["npm", "start"]
`

const reactviteDockerfile = () => `
# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --verbose
COPY . .
RUN npm run build --verbose

# Production stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`

const laravelDockerfile = () => `
FROM php:8.2-fpm
WORKDIR /var/www/html
COPY . .
RUN apt-get update -y && apt-get install -y libzip-dev zip unzip \
    && docker-php-ext-install pdo_mysql zip
RUN echo "✅ PHP extensions installed successfully"
EXPOSE 9000
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
            node_modules
            npm-debug.log
            .git
            .nyc_output
            coverage
            .DS_Store
            *.log
            .dockerignore
            README.md
           .gitignore
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

    try {
      fs.rmSync(projectPath, { recursive: true, force: true });
      console.log(`✅ Deleted cloned repo: ${projectPath}`);
    } catch (err) {
      console.error(`⚠️ Failed to delete ${projectPath}:`, err);
    }

    } catch (error) {
        console.error("Error cloning repository:", error);
        sendEmail('venky15.12.2005@gmail.com','Error Occured While Git Access',`There was an error creating the project ${projectName} located at ${repoUrl}. Please check the logs for more details.`)
        res.status(500).json({ error: "Failed to clone repository" });
    }
};