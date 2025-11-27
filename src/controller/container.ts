import { Request, Response } from "express";
import ContainerModel from "../model/container.model";
import { AuthRequest } from "../middleware/authmiddleware";

export const containerstats = async(req: AuthRequest, res: Response) => {
    try {
        const _id = req.user?.userid;

        if(!_id) return res.status(401).json({message: 'Id not found'});

        const container = await ContainerModel.findOne({ownerId:_id});

        if(!container) return res.status(401).json({message: "Container not found"});
    } catch (error) {
        return res.status(500).json({message:"Internal error occured",error});
    }
}