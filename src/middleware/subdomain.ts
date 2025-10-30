import { Request, Response, NextFunction } from "express";
import ContainerModel from "../model/container.model";
import Docker from "dockerode";

const docker = new Docker({ host: "localhost", port: 2375 
    // socketPath: "/var/run/docker.sock"
});

export const subdomainMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const host = (req.headers.host || "").split(':')[0];
    if(!host?.endsWith('.jitalumni.site')) return next();

    if (!host) {
        return res.status(400).send("Host header is missing");
    }
    
    const subdomain = host.replace('.jitalumni.site','');
    const container = await ContainerModel.findOne({ subdomain });
    if (!container) {
        return res.status(404).send("Subdomain not found");
    }

    if(container.status === "stopped"){
    try{
        const dockerContainer = docker.getContainer(container.containerId);
        await dockerContainer.start();
        container.status = "running";
        await container.save();
    } catch (error) {
      console.error("Error in subdomain middleware:", error);
      return res.status(500).send("Internal server error");
    }
}

    container.lastActive = new Date();
    await container.save();

    next();
}