import mongoose from 'mongoose';

export interface IProject extends mongoose.Document{
    owner: string,
    repoFullName: string,
    cloneURL : string,
    webhookSecret: string;
    createdAt: Date;
    updatedAt: Date;
}

const projectSchema = new mongoose.Schema<IProject>({
    owner: { type: String, required: true },
    repoFullName: { type: String, required: true },
    cloneURL: { type: String, required: true },
    webhookSecret: { type: String, required: true }
},{ timestamps: true });

const Project = mongoose.model<IProject>('Project', projectSchema);
export default Project;