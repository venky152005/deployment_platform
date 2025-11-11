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

        console.log("variables:",variables);

        await redeployWithNewVariables({
            body: {
                _id: container._id,
                image: container.image,
                subdomain: container.subdomain,
                containerId: container.containerId,
                containerport: container.containerport, 
                variables: variables
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
      console.log(_id, image, subdomain, containerId, containerport, variables);
       const startTime = new Date();
       console.log("Time:", new Date().toLocaleString());

       if (!image || !subdomain || !_id || !containerId || !containerport) {
           return res.status(400).json({ error: "Image, Subdomain, Project ID, Container ID, and Container Port are required" });
       }

       try {
   
       await docker.ping();
       
       console.log("Docker daemon is reachable");
   
       const dockerfilePath = `./repos`;
       console.log("Using Docker path:", dockerfilePath);
       const envfilePath = path.join(dockerfilePath,'.env');
   
       if(!fs.existsSync(dockerfilePath)){
           return console.log({ error: "Build the project before creating a Docker image" });
       }

       const envData = Object.entries(variables || {}).map(([key, value]) => `${key}=${value}`).join('\n');
       console.log("Generated .env data:\n", envData);

       fs.writeFileSync(envfilePath, envData);
       console.log("Environment variables written to .env file");

       const Dockerfile = `
FROM ${image}

WORKDIR /app

COPY . .
COPY .env /app/.env

EXPOSE ${containerport}

ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]
`;

        
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

      const attachStream = await container.attach({
  stream: true,
  stdout: true,
  stderr: true,
});

attachStream.pipe(process.stdout);

console.log("🚀 Starting container...");
await container.start();


    let containerIP = null;
for (let i = 0; i < 10; i++) {
  const inspectData = await container.inspect();
  const networks = inspectData.NetworkSettings?.Networks;
  const firstNetwork = networks && Object.values(networks)[0];
  containerIP = firstNetwork?.IPAddress;
  const healthState = inspectData.State?.Health?.Status || "unknown";
  
  console.log(`🔁 Attempt ${i + 1}: IP=${containerIP || "N/A"} | Health=${healthState}`);

  if (containerIP && healthState === "healthy") {
    console.log("✅ Container is ready and healthy!");
    break;
  }
  if (containerIP) break;
  await new Promise(res => setTimeout(res, 3000)); // retry every second
}


if (!containerIP) {
  console.error("❌ Could not fetch container IP after retries.");
} else {
  console.log("🌐 IPAddress:", containerIP);
}

       const healthUrl =`http://${containerIP}:${containerport}`;
       console.log(`Container started and accessible at ${healthUrl}`);

       let isHealthy = false;
       for (let i = 0; i < 10; i++) {
           try {
               const response = await axios.get(healthUrl,{
               timeout: 5000, // 5 seconds
               headers: { 'Accept': 'application/json'
               }});
               console.log(`Health check attempt ${i + 1}: Status ${response.status}`);
               if (response.status === 200) {
                   isHealthy = true;
                   break;
               }
           } catch (error) {
            console.log(`⏳ Health check ${i + 1}/10 failed. Retrying...`);
  }
  await new Promise(res => setTimeout(res, 1000));
       }

       if (!isHealthy) {
              console.error(`Container ${container.id} failed health checks`);
              await container.stop().catch(() => {console.error("Error stopping container after failed health checks")});
              await container.remove().catch(() => {console.error("Error removing container after failed health checks")});
              await docker.getImage(imgname).remove({ force: true }).catch(() => {});
              return console.log({ error: "Container failed health checks" });
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

       console.log(`✅ Redeployed container ${container.id} in ${elapsed} seconds on port ${hostport}`);

       } catch (error) {
           await sendEmail("venky15.12.2005@gmail.com", `Docker environment variables for ${image} creation failed`, `There was an error creating the Docker environment for project ${image}. Please check the logs for more details.`);
           console.error("Error creating Docker environment:", error);
       }
      
   };
   
