import mongoose from 'mongoose';

export interface IUser extends mongoose.Document{
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    github_oauth_state: string;
    accessToken: string;
    createdAt: Date;
    updatedAt: Date;
} 

const userSchema = new mongoose.Schema<IUser>({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    password: { type:String, required: true },
    github_oauth_state: { type: String, select: false},
    accessToken: { type:String, select: false},
},{timestamps: true})

const User = mongoose.model<IUser>('User',userSchema);
export default User;