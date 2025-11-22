import { Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import User from "../model/user.model";
import { AuthRequest } from "../middleware/authmiddleware";
import Project from "../model/project.model";
import { cloneRepo } from "./github";

export const connect = async(req: AuthRequest, res: Response) => {
    const state = crypto.randomBytes(12).toString("hex");
    const _id = req.user?.userid;
    console.log('id:',_id)
 
    await User.updateOne({_id},{ $set: {
        github_oauth_state: state
    }})

    const params = new URLSearchParams({
         client_id: process.env.GITHUB_CLIENT_ID!,
         scope: "repo admin:repo_hook",
         state,
         allow_signup:"true",
    }).toString();

    const redirectUrl = `https://github.com/login/oauth/authorize?${params}`;

    return res.json({ url: redirectUrl });
}

export const callback = async(req:Request, res:Response) =>{
    const {code, state } = req.query;

    if(!code){
        return res.status(400).json({message:" Code is missing "});
    }

    if(!state){
        return res.status(400).json({message: 'State is missing'})
    }

    const user = await User.findOne({github_oauth_state: state});
    const _id = user!._id;

    try {
        const tokenresp = await axios.post('https://github.com/login/oauth/access_token',{
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
            state
        },{ 
            headers: {Accept: 'application/json'} 
        });

        const accessToken = tokenresp.data.access_token;

        if(!accessToken) return res.status(401).json({message:"Failed to get access token"});

        await User.updateOne({_id},
            { $set:{ accessToken: accessToken }}
        )

         return res.redirect(
      "https://deployment-platform-frontend.vercel.app/auth/github/callback"
    );
    } catch (error: any) {
        console.error("OAuth callback error:", error.response?.data || error.message);
        res.status(500).send("GitHub auth failed");
    }
};

export const repolist = async(req: AuthRequest, res: Response) => {
   const _id = req.user?.userid;
   const userinfo = await User.findById(_id).select("+accessToken");
   console.log("userinfo:",userinfo);

   if(!userinfo){
     return res.status(401).json({message: 'User not found for Repolist'});
   }

   const token = userinfo.accessToken;
    console.log('token:', token);

   const resp = await axios.get(`https://api.github.com/user/repos`,{
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json"
      }
   });

   return res.status(200).json({message: 'Repolist fetched', data: resp.data});
};

export const create_webhook = async(req: AuthRequest, res: Response) => {
    const { repoFullName } = req.body;
    const _id = req.user?.userid;

    console.log('reponame:',repoFullName);

    const webhookSecret = crypto.randomBytes(16).toString('hex');

    if(!_id){
        return res.status(400).json({message: 'Id is not found'});
    }

    const user = await User.findById(_id).select("+accessToken");
    const accessToken = user!.accessToken;
    console.log('token:',accessToken);

    if(!accessToken){
        return res.status(401).json({message: "Access token didn't found"});
    }
    
    const resp = await axios.post(`https://api.github.com/repos/${repoFullName}/hooks`,{
      name:'web',
      active: true,
      events: ['push'],
      config:{
        url: `${process.env.SERVER_URL}/api/webhook`,
        content_type: 'json',
        secret: webhookSecret
      }
    },{
        headers:{ 
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json"
        }
    }
);

  console.log(resp.data);

const repoURL = `https://github.com/${repoFullName}.git`;
const projectName = repoFullName.split('/')[1];

await Project.create({
    owner: _id,
    repoFullName: repoFullName,
    cloneURL: repoURL,
    webhookSecret: webhookSecret
});

 await cloneRepo({
        body:{
            repoUrl: repoURL,
            projectName: projectName
        }
    } as Request,res);

return res.status(200).json({message: "webhook connected"});
}

export const webhook = async(req: Request, res: Response) => {
    try{
    console.log("wehook triggered")
    const raw = req.body;
    const payload = JSON.parse(raw.toString());

    const project = await Project.findOne({ repoFullName: payload.repository.full_name });
    if(!project ){
        return res.status(401).json({message:"Repo name is required"})
    }

    const signature = req.headers['x-hub-signature-256'] as String;

    const hmac = crypto.createHmac('sha256',project!.webhookSecret);
    hmac.update(raw);
    const expected = `sha256=${hmac.digest('hex')}`;

    if(!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))){
       return res.status(401).json({message:'Invalid Signature'});
    }

    const repoURL = `https://github.com/${project.repoFullName}.git`;
    const projectName = project.repoFullName.split('/')[1];

    console.log('second step completed');

    await cloneRepo({
        body:{
            repoUrl: repoURL,
            projectName: projectName
        }
    } as Request,res);

    return res.status(200).json({message: 'Project deploy successfully'});
    }catch(err){
        return res.status(500).json({message:"Internal error occured",err});
    }
}
