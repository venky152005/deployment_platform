import { Request, Response, NextFunction } from "express";
import ContainerModel from "../model/container.model";
import Docker from "dockerode";
import httpProxy from "http-proxy";
import redis from "../utils/redis";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const proxy = httpProxy.createProxyServer({});

proxy.on("proxyReq", (proxyReq, req) => {
  console.log(`Forwarding ${req.method} ${req.url}`);
});

proxy.on("proxyRes", (proxyRes, req, res) => {
  delete proxyRes.headers['transfer-encoding'];
  console.log(`Response — Status: ${proxyRes.statusCode}`);
});

proxy.on("error", (err, req, res: any) => {
  console.error(`Proxy error:`, err.message);
  if (!res.headersSent) {
    if ('writeHead' in res) {
      res.writeHead(500, { "Content-Type": "text/plain" });
    }
  }
  res.end("Proxy failed");
});

export const subdomainMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const host = (req.headers.host || "").split(':')[0];
    console.log(" Incoming Host:", host);
    if(!host?.endsWith('.jitalumni.site')) return next();

    if (!host) {
        return res.status(400).send("Host header is missing");
    }
    
     const SYSTEM_DOMAINS = new Set([
    "api.jitalumni.site",
  ]);

  if (SYSTEM_DOMAINS.has(host)) {
    console.log("Skipping wildcard middleware for:", host);
    return next();
  }

    const subdomain = host.replace('.jitalumni.site','');
    console.log(subdomain);
    
    let container;

    const cachedid = await redis.get(`subdomain:${subdomain}`);
    if (cachedid) {
       const cachedcontainer = await redis.get(`container:${cachedid}`);
       if(cachedcontainer){
        console.log("Container data fetched from Redis cache");
         const parsed = JSON.parse(cachedcontainer);
         container = await ContainerModel.findById(parsed._id);
       }
    }
    if(!container) {
      container = await ContainerModel.findOne({ subdomain });
     if (!container) {
        return res.status(404).send("Subdomain not found");
      }
       await redis.set(`subdomain:${subdomain}`,container.id, "EX", 7200);
       await redis.set(`container:${container.id}`,JSON.stringify(container),
       "EX", 7200);
    }

   try{

    const dockerstatus = await docker.getContainer(container.containerId).inspect();
    
    if(dockerstatus.State.Status !== "running"){
        const dockerContainer = docker.getContainer(container.containerId);
        await dockerContainer.start();

         let inspectData;
      for (let i = 0; i < 15; i++) {
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

    const updatedData = {
     containerId: container.containerId,
     containername: container.containername,
     subdomain: container.subdomain,
     containerport: container.containerport,
     image: container.image,
     status: "running",
     containerport: container.containerport,
     lastActive: container.lastActive,
   };

    await redis.set(`container:${container.containerId}`,JSON.stringify(updatedData),
    "EX", 7200);

    const dockerContainer = docker.getContainer(container.containerId);
    const inspectData = await dockerContainer.inspect(); 
    const networks = inspectData.NetworkSettings.Networks;
    const firstNetwork = Object.values(networks)[0];
    const containerIP = firstNetwork?.IPAddress;

    if (!containerIP) {
      console.error(` No IP found for container ${container.containerId}`);
      return res.status(500).send("Container IP not found");
    }

    const exposedPorts = Object.keys(inspectData.NetworkSettings.Ports || {});
    console.log("exposed:",exposedPorts);
    const port = container.port;
    console.log("port:",port) 

    const target = `http://${containerIP}:${port}`;
    console.log(` Proxying request for ${subdomain} → ${target}`);

    proxy.web(req, res, {
     target,
     changeOrigin: true,
     selfHandleResponse: false,
   }); 
   }catch (error) {
    console.error("Error in subdomain middleware:", error);
     if (!res.headersSent)
      return res.status(500).send("Internal server error");
  }
}

