import { Router } from "express";
import { cloneRepo } from "../controller/github";
import { setEnvironmentVariables } from "../controller/environment_variables";
import { Signup } from "../controller/auth/signup";
import { Login } from "../controller/auth/login";
import { AuthMiddleware } from "../middleware/authmiddleware";
import { callback, connect, create_webhook, repolist, webhook } from "../controller/ci-cd";

const router = Router();

router.get('/connect',AuthMiddleware,connect);
router.get('/callback',callback);
router.get('/repo/list',AuthMiddleware,repolist);
router.post('/create/webhook',AuthMiddleware,create_webhook);
router.post('/webhook',webhook);
router.post("/clone", cloneRepo);
router.post("/env/:projectId", setEnvironmentVariables);
router.post('/signup',Signup);
router.post('/login',Login);

export default router;
