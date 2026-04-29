
import { Router } from "express";
import { 
  scrapeLatestCarPaListings,
  scrapeLatestMotoPaListings,

 } from "./paPages.controller.js";

const paPagesRouter = Router();

paPagesRouter.get("/latest-car", scrapeLatestCarPaListings);
paPagesRouter.get("/latest-moto", scrapeLatestMotoPaListings);


export { paPagesRouter };