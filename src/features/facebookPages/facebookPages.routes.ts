import { Router } from "express";
import { readPagePosts, fbMe, listMyGroups } from "./facebookPages.controller.js";


export const facebookPagesRouter = Router();

// GET /api/facebook-pages
facebookPagesRouter.get("/read/:pageId", readPagePosts);
facebookPagesRouter.get("/me", fbMe);
facebookPagesRouter.get("/me/groups", listMyGroups);

