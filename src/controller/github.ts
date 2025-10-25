import { Request, Response } from "express";
import simpleGit from "simple-git";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

const git = simpleGit();

export const cloneRepo = async (req: Request, res: Response) => {
    const { repoUrl, projectName } = req.body;

    if (!repoUrl || !projectName) {
        return res.status(400).json({ error: "Repository URL and Project Name are required" });
    }

    try {
        await git.clone(repoUrl, `./repos/${projectName}`);

        const dockerfilePath = path.join(__dirname, '../../repos', projectName, 'Dockerfile');
        if (!fs.existsSync(dockerfilePath)) {
            const dockerfileContent = `# ---------- Build Stage ----------
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

`;

            fs.writeFileSync(dockerfilePath, dockerfileContent);
            console.log(`Dockerfile created at ${dockerfilePath}`);
        }

        const dockerignorefilePath = path.join(__dirname, '../../repos', projectName, '.dockerignore');
        if (!fs.existsSync(dockerignorefilePath)) {
            const dockerignoreContent = `
node_modules
.next/cache
.git
.gitignore
Dockerfile
*.log
`; 

            fs.writeFileSync(dockerignorefilePath, dockerignoreContent);
            console.log(`Dockerignorefile created at ${dockerignorefilePath}`);
        }


        return res.status(200).json({ message: `Repository cloned to ./repos/${projectName}` });
    } catch (error) {
        console.error("Error cloning repository:", error);
        res.status(500).json({ error: "Failed to clone repository" });
    }
};