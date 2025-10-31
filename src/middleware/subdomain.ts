import { Request, Response, NextFunction } from "express";
import ContainerModel from "../model/container.model";
import Docker from "dockerode";
import { createProxyMiddleware } from "http-proxy-middleware";

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

   try{
    if(container.status === "stopped"){
        const dockerContainer = docker.getContainer(container.containerId);
        await dockerContainer.start();

         let inspectData;
      for (let i = 0; i < 10; i++) {
        inspectData = await dockerContainer.inspect();
        if (inspectData.State.Running) break;
        console.log("Waiting for container to start...");
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!inspectData?.State?.Running) {
        console.error(`Container ${container.containerId} failed to start`);
        return res.status(500).send("Container failed to start");
      }
        container.status = "running";
        await container.save();
    }

    container.lastActive = new Date();
    await container.save();

    const target = `http://127.0.0.1:${container.port}`;
    console.log(`Proxying request for ${subdomain} → ${target}`);

    const proxy = createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
      onError(err: Error, req: Request, res: Response) {
        console.error(`Proxy error for ${subdomain}:`, err);
        res.status(500).send("Error proxying request");
      },
    } as any);

    return proxy(req, res, next);

}catch (error) {
    console.error("Error in subdomain middleware:", error);
    return res.status(500).send("Internal server error");
  }
}