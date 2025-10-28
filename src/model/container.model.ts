import mongoose from "mongoose";

interface ContainerDocument extends mongoose.Document {
    containerId: string;
    containername: string;
    subdomain: string;
    port: number;
    image: string;
    status: "running" | "stopped" | "paused";
    lastActive: Date;
    createdAt: Date;
    updatedAt: Date;
}

const containerSchema = new mongoose.Schema<ContainerDocument>({
    containerId: { type: String, required: true },
    containername: { type: String, required: true },
    subdomain: { type: String, required: true },
    port: { type: Number, required: true },
    image: { type: String, required: true },
    status: { type: String, enum: ["running", "stopped", "paused"], required: true },
    lastActive: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const ContainerModel = mongoose.model<ContainerDocument>("Container", containerSchema);

export default ContainerModel;
