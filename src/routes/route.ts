import { Router } from "express";
import { cloneRepo } from "../controller/github";
import { setEnvironmentVariables } from "../controller/environment_variables";

const router = Router();

router.post("/clone", cloneRepo);
router.post("/env/:projectId", setEnvironmentVariables);

export default router;