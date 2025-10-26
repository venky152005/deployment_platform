import { Router } from "express";
import { cloneRepo } from "../controller/github";
import { createContainer } from "../controller/docker";

const router = Router();

router.post("/clone", cloneRepo);
router.post("/docker", createContainer);

export default router;