import { Router } from "express";
import { cloneRepo } from "../controller/github";
import { createContainer } from "../controller/docker";

const router = Router();

router.post("/clone", cloneRepo);
router.post("/docker", createContainer);
// router.get("/docker/container/logs/:containername", containerlogs);

export default router;