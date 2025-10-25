import Docker from "dockerode";
import { Request, Response } from "express";
import notifier from "node-notifier";
import tar from "tar-fs";
import fs from "fs";

const docker = new Docker({ host: "localhost", port: 2375 }); 

export const createContainer = async (req: Request, res: Response) => {

    const { projectPath, projectName } = req.body;

    console.log("Received request to create Docker container with data:", req.body);
    console.log("Time:", new Date().toLocaleString());

    if (!projectPath || !projectName) {
        return res.status(400).json({ error: "Project Path and Project Name are required" });
    }

    const imageName = projectName.toLowerCase();

    try {

    await docker.ping();
    
    console.log("Docker daemon is reachable");

    const dockerfilePath = `${projectPath}\\Dockerfile`

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
                "build"].includes(file)
            )
        });

        docker.buildImage(
            tarstream, {
                t: imgname,
                dockerfile:'Dockerfile',
                rm: true,   
                forcerm: true,
                pull: true, 
                buildargs:{
                    DOCKER_BUILDKIT: "1"
                }
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

    const containername = `${imageName}-${Date.now()}`

    const container = await docker.createContainer({
        Image: imgname,
        name: containername,
        ExposedPorts: { "3000/tcp": {} },
        HostConfig: {
            PortBindings: { "3000/tcp": [{ HostPort: "3000" }] }
        }
    });

    await container.start();

    notifier.notify({
         title:'Request completed successfully',
         sound:true,
         message:"Super daa mapla"
        });

    res.status(200).json({ message: `Docker container ${projectName} created and started` });

    } catch (error) {
         notifier.notify({
         title:'Request failed',
         sound:true,
         message:"Super daa mapla thiripiyum try pannu"
        });
        console.error("Error creating Docker container:", error);
        res.status(500).json({ error: "Failed to create Docker container" });
    }
   
};

