import { Request, Response } from "express";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from "../../model/user.model";

export const Login = async(req:Request, res:Response) => {
    const { email, password } = req.body;

    if(!email){
        return res.status(401).json({message:'Email is required'});
    }

    if(!password){
        return res.status(401).json({message:'Password is required'});
    }

    try {
        const existingUser = await User.findOne({email});

        if(!existingUser){
            return res.status(401).json({message:'User not found'});
        }

        const verifyPassword = await bcrypt.compare(password, existingUser.password);

        if(!verifyPassword){
            return res.status(401).json({message:'Invalid Password'});
        }

        if(!process.env.JWT_SECRET_KEY){
            return res.status(401).json({message:'Key error occured'});
        }

     const token = jwt.sign({id: existingUser._id,email: email},process.env.JWT_SECRET_KEY,{ expiresIn: '15h'});

     return res.status(200).json({message:"User Login Successfully", token})   
    } catch (error) {
        return res.status(500).json({message:'Internal error occured', error});
    }
}