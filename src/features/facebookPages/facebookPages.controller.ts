import type { Request, Response } from "express";
import { graphGet } from "../../lib/facebookGraph.js";

export async function fbMe(_req: Request, res: Response): Promise<void> {
  const me = await graphGet<{ id: string; name: string }>("/me", { fields: "id,name" });
  res.json(me);
}

export async function readPagePosts(req: Request, res: Response): Promise<void> {
  const { pageId } = req.params;

  const posts = await graphGet(`/${pageId}/feed`, {
    fields: "id,message,created_time,permalink_url",
    limit: "5"
  });

  res.status(200).json(posts);
}

export async function listMyGroups(_req: Request, res: Response): Promise<void> {
  const groups = await graphGet("/me/groups", {
    fields: "id,name,privacy",
    limit: "50"
  });

  res.json(groups);
}
