import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { ContextStore } from '@/server/domain/context/context.store';
import {
  AetherContextPatchSchema,
  AetherContextSchema,
  ToolSchema,
  McpServerSchema,
} from '@/server/domain/context/context.schema';
import { ValidationError } from '@/server/lib/errors';

const SkillBody = z.object({ name: z.string().min(1) });
const SkillUpdateBody = z.object({ value: z.string().min(1) });
const SkillEnabledBody = z.object({ enabled: z.boolean() });

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createContextRoutes(store: ContextStore): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await store.read());
    }),
  );

  router.patch(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = AetherContextPatchSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid patch', parsed.error);
      res.json(await store.patch(parsed.data));
    }),
  );

  router.put(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = AetherContextSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid context', parsed.error);
      res.json(await store.bulkOverwrite(parsed.data));
    }),
  );

  router.post(
    '/skills',
    asyncHandler(async (req, res) => {
      const parsed = SkillBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid skill body', parsed.error);
      await store.addSkill(parsed.data.name);
      res.status(201).json({ status: 'ok' });
    }),
  );

  router.patch(
    '/skills/:index',
    asyncHandler(async (req, res) => {
      const index = parseInt(req.params.index, 10);
      if (Number.isNaN(index)) throw new ValidationError('Invalid index');
      const parsed = SkillUpdateBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid update body', parsed.error);
      await store.updateSkillAt(index, parsed.data.value);
      res.json({ status: 'ok' });
    }),
  );

  router.patch(
    '/skills/:index/enabled',
    asyncHandler(async (req, res) => {
      const index = parseInt(req.params.index, 10);
      if (Number.isNaN(index)) throw new ValidationError('Invalid index');
      const parsed = SkillEnabledBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid enabled body', parsed.error);
      await store.setSkillEnabledAt(index, parsed.data.enabled);
      res.json({ status: 'ok' });
    }),
  );

  router.delete(
    '/skills/:index',
    asyncHandler(async (req, res) => {
      const index = parseInt(req.params.index, 10);
      if (Number.isNaN(index)) throw new ValidationError('Invalid index');
      await store.removeSkillAt(index);
      res.status(204).end();
    }),
  );

  router.post(
    '/tools',
    asyncHandler(async (req, res) => {
      const parsed = ToolSchema.omit({ id: true }).safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid tool', parsed.error);
      const tool = await store.addTool(parsed.data);
      res.status(201).json(tool);
    }),
  );

  router.patch(
    '/tools/:id',
    asyncHandler(async (req, res) => {
      const parsed = ToolSchema.omit({ id: true }).partial().safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid tool patch', parsed.error);
      await store.updateTool(req.params.id, parsed.data);
      res.json({ status: 'ok' });
    }),
  );

  router.delete(
    '/tools/:id',
    asyncHandler(async (req, res) => {
      await store.removeTool(req.params.id);
      res.status(204).end();
    }),
  );

  router.post(
    '/mcp-servers',
    asyncHandler(async (req, res) => {
      const parsed = McpServerSchema.omit({ id: true }).safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid mcp server', parsed.error);
      const srv = await store.addMcpServer(parsed.data);
      res.status(201).json(srv);
    }),
  );

  router.delete(
    '/mcp-servers/:id',
    asyncHandler(async (req, res) => {
      await store.removeMcpServer(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
