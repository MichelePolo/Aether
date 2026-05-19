import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/server/lib/errors';
import {
  ProfileRecordSchema,
  ProfileImportSchema,
} from '@/server/domain/profiles/profiles.schema';
import type { ProfilesStore } from '@/server/domain/profiles/profiles.store';

const RenameBody = z.object({ name: z.string() });

const CreateBody = ProfileRecordSchema.pick({
  name: true,
  context: true,
  thinkingEnabled: true,
});

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createProfilesRoutes(store: ProfilesStore): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ profiles: await store.listProfiles() });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid profile payload', parsed.error);
      const meta = await store.create(parsed.data);
      res.status(201).json(meta);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const rec = await store.read(req.params.id);
      if (!rec) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Profile not found' } });
        return;
      }
      res.json(rec);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = ProfileRecordSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid profile body', parsed.error);
      // updateProfile preserves createdAt server-side
      const meta = await store.update(req.params.id, {
        name: parsed.data.name,
        context: parsed.data.context,
        thinkingEnabled: parsed.data.thinkingEnabled,
      });
      res.json(meta);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid rename payload', parsed.error);
      const meta = await store.rename(req.params.id, parsed.data.name);
      res.json(meta);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await store.delete(req.params.id);
      res.status(204).end();
    }),
  );

  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const parsed = ProfileImportSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid import payload', parsed.error);
      const meta = await store.create({
        name: parsed.data.name ?? 'Imported profile',
        context: parsed.data.context,
        thinkingEnabled: parsed.data.thinkingEnabled ?? false,
      });
      res.status(201).json(meta);
    }),
  );

  return router;
}
