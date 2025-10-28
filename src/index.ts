import express from "express";
import cors from "cors";
import http from "http";
import Docker from "dockerode";
import mongoose from "mongoose";
import { Server } from "socket.io";
import router from "./routes/route";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const docker = new Docker({ host: "localhost", port: 2375 
    // socketPath: "/var/run/docker.sock"
}); 
const MongoURI = process.env.MONGO_URI!;
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

mongoose.connect(MongoURI).then(() => {
    console.log("Connected to MongoDB");
}).catch((err) => {
    console.error("Error connecting to MongoDB:", err);
}); 

app.get("/", (req, res) => {
     res.json({message:"Vanakkam Daa Mapla"});
});

app.use("/api", router);

server.listen(PORT, () => {
     console.log(`Server is running on http://localhost:${PORT}`);
});

io.on("connection", (socket)=>{
 console.log("Socket Io get connected")

 
let logstream: any = null;

socket.onAny((event, ...args) => {
    console.log(`Event received: "${event}" from socket ${socket.id}`);
    console.log("Data:", args);
  });

 socket.on("stream-logs", async(data:{containername:string})=>{
       try{
   console.log("started at:", new Date().toLocaleString());
   console.log("containername:", data.containername);

   if (logstream) {
        logstream.destroy();
        logstream = null;
        console.log("Previous log stream destroyed");
      }

   const container = docker.getContainer(data.containername);
   logstream = await container.logs({
      follow: true,         
      stdout: true,         
      stderr: true,       
    });
    
  logstream.on("data", (chunk: Buffer) => {
  const log = chunk.toString();
  console.log("Docker Log:", log);
  console.log("log time:", new Date().toLocaleString());
  socket.emit("container-logs", log);
});

logstream.on("end", () => {
  console.log("Log streaming ended.");
  socket.emit("container-log-end", "Container logs ended");
});

logstream.on("error", (err: any) => {
  console.error("Log stream error:", err);
  socket.emit("container-log-error", err.message);
});

logstream.resume();
  }catch(error:any){
    console.error("Error:", error);
    socket.emit("error", error.message);
  }
},
)
}
)
