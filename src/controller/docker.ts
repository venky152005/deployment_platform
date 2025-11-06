import Docker from "dockerode";
import { Request, Response } from "express";
import { sendEmail } from "./email";
import getPort from "get-port";
import {v4 as uuid} from "uuid";
import tar from "tar-fs";
import fs from "fs";
import path from "path";
import { createNginxConfig, enableNginxConfig } from "../utils/nginx";
import ContainerModel from "../model/container.model";
import redis from "../utils/redis";

async function generateUniquePort() {
  let hostport;

  while (true) {
    const randomPort = 4000 + Math.floor(Math.random() * 1000);

    const cached = await redis.get(`port:${randomPort}`);
    if (cached) {
      console.log(`Port ${randomPort} found in Redis cache — regenerating...`);
      continue;
    }

    const exists = await ContainerModel.exists({ port: randomPort });
    if (exists) {
        await redis.set(`port:${randomPort}`, "used", "EX", 300);
      console.log(`Port ${randomPort} already used — regenerating...`);
      continue;
    }

    hostport = await getPort({ port: randomPort });
    if (hostport === randomPort) break; 
  }

  return hostport;
}

const docker = new Docker({ socketPath: "/var/run/docker.sock" }); 

function slugify(name: string){
    return name.toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/\-+/g, "-")
    .slice(0, 40);
} 

export const createContainer = async (req: Request, res: Response) => {

    const { projectPath, projectName } = req.body;

    const startTime = new Date();
    console.log("Received request to create Docker container with data:", req.body);
    console.log("Time:", new Date().toLocaleString());

    if (!projectPath || !projectName) {
        return res.status(400).json({ error: "Project Path and Project Name are required" });
    }

    const imageName = projectName.toLowerCase();

    try {

    await docker.ping();
    
    console.log("Docker daemon is reachable");

    const dockerfilePath = `${projectPath}/Dockerfile`

    if(!fs.existsSync(dockerfilePath)){
        return res.status(400).json({ error: "Build the project before creating a Docker image" });
    }

    const dockerPath = projectPath.replace(/\\/g, '/'); 
    console.log("Using Docker path:", dockerPath);

   const imgname = `${imageName}:${Date.now()}`

    await new Promise((resolve, reject) => {

        const tarstream = tar.pack(dockerPath, {
            entries: fs.readdirSync(dockerPath).filter(file => ![
                "node_modules",
             ".next",
             ".git",
             "dist",
             "build", 
             ".cache",
             "coverage",
             "*.log",
             "*.tmp",
             ".DS_Store"].includes(file)
            )
        });

        docker.buildImage(
            tarstream, {
                t: imgname,
                dockerfile:'Dockerfile',
                rm: true,   
                forcerm: true,
            },
            (err: any, stream: any) => {
                if (err) {
                    console.error("Error building Docker image:", err);
                    return reject(err);
                }
                docker.modem.followProgress(stream, (err: any, res: any) => {
                    if (err) {
                        console.error("Error during Docker image build:", err);
                        return reject(err);
                    }
                    console.log("Docker image built successfully:", res);
                    resolve(res);
                },(event) => {
        if (event.stream) process.stdout.write(event.stream);  
        if (event.status) console.log(event.status);          
    });
            });
    });

    const hostport = await generateUniquePort();

    const containername = `${imageName}-${Date.now()}`

    let container

    let containerport = "3000";

    if (fs.existsSync(path.join(projectPath, "vite.config.js")) || fs.existsSync(path.join(projectPath, "vite.config.ts"))) {
      containerport = "80";
    }else {
  const serverFile = ["server.js", "app.js", "index.js"]
    .map(f => path.join(projectPath, f))
    .find(f => fs.existsSync(f));

  if (serverFile) {
    const content = fs.readFileSync(serverFile, "utf8");
    if (content.includes("8000") || content.includes("process.env.PORT") || content.includes(":8000")) {
      containerport = "8000";
    } else if (content.includes("3000") || content.includes(":3000")) {
      containerport = "3000";
    }
  }
}
 

   try{
     container = await docker.createContainer({
        Image: imgname,
        name: containername,
        ExposedPorts: { [`${containerport}/tcp`]: {} },
        HostConfig: {
            PortBindings: { [`${containerport}/tcp`]: [{ HostPort: String(hostport) }] },
            AutoRemove: false,
            NetworkMode: "bridge"
        }
    });
   }catch(err){
     console.error("Container create error =>", err);
     throw err;
   }

    await container.start().catch(err => {
  console.error("Container start error =>", err);
  throw err;
});
    const endTime = new Date();
    const totalTime = (endTime.getTime() - startTime.getTime()) / 1000;

    const shortId = uuid().slice(0,6);
    const subdomain = slugify(projectName);
    const finalsubdomain = `${subdomain}-${shortId}`;

    const config = await createNginxConfig(finalsubdomain,8000);
    await enableNginxConfig(finalsubdomain, config);

    const doc = await ContainerModel.create({
        containerId: container.id,
        containername: containername,
        subdomain: finalsubdomain,
        port: hostport,
        image: imgname,
        status: "running",
        lastActive: new Date(),
    })

    await redis.set(`container:${container.id}`,JSON.stringify({
        containerId: container.id,
        containername: containername,
        subdomain: finalsubdomain,
        port: hostport,
        image: imgname,
        status: "running",
        lastActive: new Date(),
    }),
    "EX", 7200);

    await redis.set(`subdomain:${finalsubdomain}`, container.id, "EX", 7200);

    const elapsed = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
    const publicUrl = `https://${finalsubdomain}.jitalumni.site`;

    res.status(200).json({ message: `Docker container ${projectName} created and started in ${totalTime} seconds`,url: publicUrl, hostport, containerId: container.id || containername, deployment: doc, elapsed, });

    } catch (error) {
        await sendEmail("venky15.12.2005@gmail.com", `Docker container ${projectName} creation failed`, `There was an error creating the Docker container for project ${projectName} located at ${projectPath}. Please check the logs for more details.`);
        console.error("Error creating Docker container:", error);
        res.status(500).json({ error: "Failed to create Docker container" });
    }
   
};

