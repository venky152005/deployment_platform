import { Request, Response } from "express";
import simpleGit from "simple-git";
import fs from "fs";
import path from "path";
import { sendEmail } from "./email";
import { createContainer } from "./docker";
import Dockerfile from "../utils/addfile";

const git = simpleGit();

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
    const { ownerId, repoUrl, projectName, variables } = req.body;

    console.log('clone repo _id:',ownerId);
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
            dockerfileContent = Dockerfile.nextjsDockerfile();
            dockerignoreContent += `\nnode_modules\n.next`;
        } else if (packageJson.dependencies && packageJson.dependencies.express) {
            const entrypoint = getNodeEntrypoint(packageJson);
            console.log("Project name:",projectName,"Run Command:",entrypoint);
            dockerfileContent = Dockerfile.expressDockerfile(entrypoint);
            dockerignoreContent += `\nnode_modules`;
        } else if (packageJson.dependencies && (packageJson.dependencies.react || packageJson.dependencies.vite)) {
           dockerfileContent = Dockerfile.reactviteDockerfile();
           dockerignoreContent += `\nnode_modules\n.dist`;
        } else if (fs.existsSync(path.join(projectPath, 'artisan'))) {
            dockerfileContent = Dockerfile.laravelDockerfile();
        }else{
            const entrypoint = getNodeEntrypoint(packageJson);
            console.log("Project name:",projectName,"Run Command:",entrypoint);
            dockerfileContent = Dockerfile.nodeDockerfile(entrypoint);
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
                _id: ownerId,
                projectPath: projectPath,
                projectName: projectName,
                variables: variables
            }
        } as Request, res);

    try {
      fs.rmSync(projectPath, { recursive: true, force: true });
      console.log(`Deleted cloned repo: ${projectPath}`);
    } catch (err) {
      console.error(`Failed to delete ${projectPath}:`, err);
    }

    } catch (error) {
        console.error("Error cloning repository:", error);
        sendEmail('venky15.12.2005@gmail.com','Error Occured While Git Access',`There was an error creating the project ${projectName} located at ${repoUrl}. Please check the logs for more details.`)
        res.status(500).json({ error: "Failed to clone repository" });
    }
};
