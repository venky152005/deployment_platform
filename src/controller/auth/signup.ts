import { Request, Response } from "express";
import bcrypt from "bcrypt";
import User from "../../model/user.model";

export const Signup = async(req:Request, res: Response)=>{
    const { firstName, lastName, email, password } = req.body;

    if(!firstName){
        return res.status(401).json({message:'Firstname is required'});
    }

    if(!lastName){
        return res.status(401).json({message:'Lastname is required'});
    }

    if(!email){
        return res.status(401).json({message:'Email is required'});
    }

    if(!password){
        return res.status(401).json({message:'Password is required'});
    }

    try {
        
        const existingUser = await User.findOne({email: email});

        if(existingUser){
            return res.status(501).json({message: 'User already exist'});
        }

        const hashpassword = await bcrypt.hash(password,10);

        const user = await User.create({
            firstName,
            lastName,
            email,
            password: hashpassword
        });

        return res.status(200).json({message: 'User register successfully', user});
    } catch (error) {
        return res.status(500).json({message: 'Internal error occured',error});
    }
}