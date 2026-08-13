import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';

/**
 * Middleware factory za Zod validation
 * Korišćenje: app.post('/api/alerts', validateRequest(createAlertSchema), controller)
 */
export function validateRequest(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Nevaljana ulazna polja',
           details: error.issues.map((e: any) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      return res.status(500).json({
        error: 'Greška pri validaciji',
      });
    }
  };
}

/**
 * Middleware za query parameter validaciju
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.query);
      req.query = validated as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Nevaljani query parametri',
           details: error.issues.map((e: any) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      return res.status(500).json({
        error: 'Greška pri validaciji query parametara',
      });
    }
  };
}

/**
 * Middleware za params validaciju
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.params);
      req.params = validated as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Nevaljani URL parametri',
           details: error.issues.map((e: any) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      return res.status(500).json({
        error: 'Greška pri validaciji URL parametara',
      });
    }
  };
}
