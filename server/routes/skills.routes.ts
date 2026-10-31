import { asyncHandler } from '@/server/lib/async-handler';
import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/server/lib/errors';
import type { SkillsService } from '@/server/domain/skills/skills.service';


const EnabledBody = z.object({ enabled: z.boolean() });
const PinnedBody = z.object({ pinned: z.boolean() });
const PromoteBody = z.object({ slug: z.string().min(1) });
const ContentBody = z.object({ content: z.string().max(512 * 1024), draft: z.boolean().optional() });
const isDraft = (q: unknown) => q === '1' || q === 'true';

export function createSkillsRoutes(service: SkillsService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(service.list());
    }),
  );

  router.patch(
    '/:slug/enabled',
    asyncHandler(async (req, res) => {
      const parsed = EnabledBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid enabled body', parsed.error);
      service.setEnabled(req.params.slug, parsed.data.enabled);
      res.json({ status: 'ok' });
    }),
  );

  router.patch(
    '/:slug/pinned',
    asyncHandler(async (req, res) => {
      const parsed = PinnedBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid pinned body', parsed.error);
      service.setPinned(req.params.slug, parsed.data.pinned);
      res.json({ status: 'ok' });
    }),
  );

  router.post(
    '/promote',
    asyncHandler(async (req, res) => {
      const parsed = PromoteBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid promote body', parsed.error);
      service.promote(parsed.data.slug);
      res.json({ status: 'ok' });
    }),
  );

  router.get(
    '/:slug/content',
    asyncHandler(async (req, res) => {
      res.json({ content: service.readContent(req.params.slug, { draft: isDraft(req.query.draft) }) });
    }),
  );

  router.put(
    '/:slug/content',
    asyncHandler(async (req, res) => {
      const parsed = ContentBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid content body', parsed.error);
      service.writeContent(req.params.slug, parsed.data.content, { draft: parsed.data.draft });
      res.json({ status: 'ok' });
    }),
  );

  router.delete(
    '/:slug',
    asyncHandler(async (req, res) => {
      service.remove(req.params.slug);
      res.status(204).end();
    }),
  );

  return router;
}
