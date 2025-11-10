import { Request, Response } from "express";
import ContainerModel from "../model/container.model.js";
import fs from "fs";
import Docker from "dockerode";
import tar from "tar-fs";
import getPort from "get-port";
import { sendEmail } from "./email.js";
import path from "path";
import redis from "../utils/redis.js";
import axios from "axios";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

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

export const setEnvironmentVariables = async (req: Request, res: Response) => {
    const _id = req.params.projectId;
    const { variables } = req.body;
    
    try {
        const container = await ContainerModel.findOne({ _id });
        if (!container) {
            return res.status(404).json({ message: "Container not found" });
        }

        await ContainerModel.updateOne(
            { _id },
            { $set: { variables } },
            { upsert: true },
        );

        await redeployWithNewVariables({
            body: {
                _id: container._id,
                image: container.image,
                subdomain: container.subdomain,
                containerId: container.containerId,
                containerport: container.containerport, 
            }
        } as Request, res);

        return res.status(200).json({ message: "Environment variables updated"});
    } catch (error) {
        console.error("Error updating environment variables:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};


export const redeployWithNewVariables = async (req: Request, res: Response) => {
      const { _id, image, subdomain, containerId, containerport, variables } = req.body;
       const startTime = new Date();
       console.log("Time:", new Date().toLocaleString());

       if (!image || !subdomain || !_id || !containerId || !containerport) {
           return res.status(400).json({ error: "Image, Subdomain, Project ID, Container ID, and Container Port are required" });
       }

       try {
   
       await docker.ping();
       
       console.log("Docker daemon is reachable");
   
       const dockerfilePath = `../repos`;
       console.log("Using Docker path:", dockerfilePath);
       const envfilePath = path.join(dockerfilePath,'.env');
   
       if(!fs.existsSync(dockerfilePath)){
           return res.status(400).json({ error: "Build the project before creating a Docker image" });
       }

       const envData = Object.entries(variables || {})
       .map(([key, value]) => `${key}=${value}`)
       .join('\n');

       fs.writeFileSync(envfilePath, envData);
       console.log("Environment variables written to .env file");

       const Dockerfile = `
       FROM ${image}
       WORKDIR /app
       COPY .env /app/.env
       ENV NODE_ENV=production
       EXPOSE ${containerport}
       CMD ["sh", "-c", "bun server.js || bun start || yarn start || npm start || bun run start || bun index.js || node index.js"]
       `

         fs.writeFileSync(path.join(dockerfilePath,'Dockerfile'), Dockerfile);

       const imageName = image.split(":")[0];

      const imgname = `${imageName}:${Date.now()}`
   
       await new Promise((resolve, reject) => {
           const tarstream = tar.pack(dockerfilePath, {
               entries: fs.readdirSync(dockerfilePath).filter(file => ![
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
       const containername = `${imageName}-${Date.now()}`;

       let container;
   
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

       const healthUrl =`http://localhost:${hostport}`;
       console.log(`Container started and accessible at ${healthUrl}`);

       let isHealthy = false;
       for (let i = 0; i < 10; i++) {
           try {
               const response = await axios.get(healthUrl);
               if (response.status === 200) {
                   isHealthy = true;
                   break;
               }
           } catch (error) {
            console.error("Health check error =>", error);
        }
       }

       if (!isHealthy) {
              console.error(`Container ${container.id} failed health checks`);
              await container.stop().catch(() => {});
              await container.remove().catch(() => {});
              await docker.getImage(imgname).remove({ force: true }).catch(() => {});
              return res.status(500).json({ error: "Container failed health checks" });
       }
       console.log(`Container ${container.id} passed health checks`);

       const endTime = new Date();
       const totalTime = (endTime.getTime() - startTime.getTime()) / 1000;

       const oldcontainer = await docker.getContainer(containerId);
        try {
           await oldcontainer.stop();
           await oldcontainer.remove({ force: true });
           await docker.getImage(image).remove({ force: true });
           console.log(`🧹 Old container and image removed.`);
       } catch (err) {
      console.warn("⚠️ Cleanup error:", err);
    }
   
       await ContainerModel.updateOne(
           { _id },
           {
            $set: {
                image: imgname,
                containername: containername,
                containerId: container.id,
                port: hostport,
                status: "running",
                lastActive: new Date(),
           }
        }
       );

       await redis.set(`container:${container.id}`,JSON.stringify({
           containerId: container.id,
           containername: containername,
           port: hostport,
           image: imgname,
           status: "running",
           lastActive: new Date(),
       }),
       "EX", 7200);
   
       const elapsed = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);

       res.status(200).json({ message: `Docker environment ${imageName} created and started in ${totalTime} seconds`, hostport, containerId: container.id || containername, elapsed, });

       } catch (error) {
           await sendEmail("venky15.12.2005@gmail.com", `Docker environment variables for ${image} creation failed`, `There was an error creating the Docker environment for project ${image}. Please check the logs for more details.`);
           console.error("Error creating Docker environment:", error);
           res.status(500).json({ error: "Failed to create Docker environment" });
       }
      
   };
   