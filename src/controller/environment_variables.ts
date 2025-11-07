import { Request, Response } from "express";
import ContainerModel from "../model/container.model.js";
import Docker from "dockerode";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });


export const setEnvironmentVariables = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { variables } = req.body;

    try {
        const container = await ContainerModel.findOne({ projectId });
        if (!container) {
            return res.status(404).json({ message: "Container not found" });
        }

        await ContainerModel.updateOne(
            { projectId },
            { $set: { variables } },
            { upsert: true },
        );

        await redeployWithNewVariables(projectId);

        return res.status(200).json({ message: "Environment variables updated"});
    } catch (error) {
        console.error("Error updating environment variables:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};


export const redeployWithNewVariables = async (projectId: any) => {
    const env = await ContainerModel.findOne({ projectId });

    if (!env || !env.variables) {
        throw new Error("No environment variables found for the given projectId");
    }

    const envVars = Object.entries(env.variables).map(([key, value]) => `${key}=${value}`);

    const oldcontainer = docker.getContainer(env.containerId);

    const containerInfo = await oldcontainer.inspect();
    const exposedPorts = Object.keys(containerInfo.NetworkSettings.Ports || {});

    let containerport = 3000;

    if( exposedPorts.includes("80/tcp")) containerport = 80;
    else if( exposedPorts.includes("3000/tcp")) containerport = 3000;
    else if( exposedPorts.includes("8000/tcp")) containerport = 8000;

    try {
        await oldcontainer.stop();
        await oldcontainer.remove();
        console.log(`Old container ${env.containerId} stopped and removed successfully.`);
    } catch (error) {
        console.error("Error stopping and removing old container:", error);
    }

    const newcontainer = await docker.createContainer({
        Image: env.image,
        name: env.containername,
        ExposedPorts: { [`${containerport}/tcp`]: {} },
        HostConfig: {
            PortBindings: { [`${containerport}/tcp`]: [{ HostPort: env.port.toString() }] },
            RestartPolicy: { Name: "always" },
        },
        Env: envVars,
    });
    
    await newcontainer.start();

    await ContainerModel.updateOne(
        { projectId },
        { $set: { 
            containerId: newcontainer.id,
            containerport: containerport,
            status: "running",
            updatedAt: new Date()
         } 
        }
    );

    console.log(`New container ${newcontainer.id} started successfully with updated environment variables.`);
}