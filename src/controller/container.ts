import { Request, Response } from "express";
import ContainerModel from "../model/container.model";
import { AuthRequest } from "../middleware/authmiddleware";
import Docker from "dockerode";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export const containerstats = async(req: AuthRequest, res: Response) => {
    try {
        const { subdomain } = req.body;
        const _id = req.user?.userid;

        if(!_id) return res.status(401).json({message: 'Id not found'});

        const container = await ContainerModel.findOne({ownerId:_id, subdomain:subdomain });

        if(!container) return res.status(401).json({message: "Container not found"});

        const stats = docker.getContainer(container.containerId);
        const containerStats = await stats.stats({stream:false});

        return res.status(200).json({message: "Container stats fetched successfully", stats: containerStats});
    } catch (error) {
        return res.status(500).json({message:"Internal error occured",error});
    }
};


export const containerlogs = async(req: AuthRequest, res: Response) => {
    try {
        const { subdomain } = req.body;
        const _id = req.user?.userid;

        if(!_id) return res.status(401).json({message: 'Id not found'});

        const container = await ContainerModel.findOne({ownerId:_id, subdomain:subdomain });

        if(!container) return res.status(401).json({message: "Container not found"});

        const logs = docker.getContainer(container.containerId);
        const containerLogs = await logs.logs({
            stdout: true,
            stderr: true,
            tail: 100
        });

        return res.status(200).json({message: "Container logs fetched successfully", logs: containerLogs.toString('utf-8')});
    } catch (error) {
        return res.status(500).json({message:"Internal error occured",error});
    }
};