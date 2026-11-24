import { z } from 'zod';

const layerId = z.string().min(1).max(1024);
const designTarget = {
  documentId: z.string().min(1).max(256).optional().describe('Document ID from get_active_design. Reject a different active draft.'),
  revision: z.string().min(1).max(256).optional().describe('Revision from get_active_design. Omit to read the latest revision.'),
  layerId: layerId.optional().describe('A layer or artboard ID from get_active_design or inspect_design.'),
};

export const inspectDesignInput = { ...designTarget,
  mode: z.enum(['index', 'layers']).optional().describe('Compact layer tree or detailed layer properties. Defaults to layers.'),
  layerIds: z.array(layerId).min(1).max(32).optional().describe('Read up to 32 layer or artboard roots in one request. Use in place of layerId.'),
  name: z.string().min(1).max(1024).optional().describe('Exact layer name to find within the requested scope.'),
  maxDepth: z.number().int().nonnegative().optional().describe('Depth below the requested roots. 0 returns only the roots, 1 includes direct children. Omit to include all descendants.'),
  limit: z.number().int().min(1).max(256).optional().describe('Maximum layers per page. Index mode caps at 256 and layers mode at 64. Large entries may shorten the page.'),
  offset: z.number().int().nonnegative().optional().describe('Continue at nextOffset with the same targets, filters, and revision.'),
};
export const previewDesignInput = designTarget;

export const designMcpReadRequest = z.object({
  read: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('active') }),
    z.object({ kind: z.literal('inspect'), ...inspectDesignInput }),
    z.object({ kind: z.literal('preview'), ...previewDesignInput }),
  ]),
  agent: z.object({ id: z.uuid(), name: z.string().max(80) }),
});
