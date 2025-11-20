import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request{
    user?:{
        userid: string,
        email: string,
    }
}

export const AuthMiddleware = async(req:AuthRequest,res:Response,next:NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];

    if(!token){
        return res.status(401).json({meesage: 'No token provided'});
    }

    if(!process.env.JWT_SECRET_KEY){
        return res.status(401).json({message:'JWT secret is not defined'});
    }

    try {
        const decoded = jwt.verify(token,process.env.JWT_SECRET_KEY) as { id: string, email: string };
        req.user = {
            userid: decoded.id,
            email: decoded.email
        };
        next();
    } catch (error) {
        return res.status(500).json({message:'Internal error occured', error});
    }
}