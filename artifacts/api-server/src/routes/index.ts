import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import scenesRouter from "./scenes";
import sourcesRouter from "./sources";
import streamRouter from "./stream";
import outputRouter from "./output";
import audioRouter from "./audio";
import uploadsRouter from "./uploads";
import rtmpRouter from "./rtmp";
import serverInfoRouter from "./serverInfo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(scenesRouter);
router.use(sourcesRouter);
router.use(streamRouter);
router.use(outputRouter);
router.use(audioRouter);
router.use(uploadsRouter);
router.use(rtmpRouter);
router.use(serverInfoRouter);

export default router;
