import { z } from "zod";
import { directoryManifest } from "../shared/directory-import";
import { iamManageProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  changeDirectoryRow,
  directoryAccess,
  listDirectoryBatches,
  previewDirectory,
  readDirectoryBatch,
} from "./directory-import";

const batch = z.object({ id: z.string().uuid() });
const row = batch.extend({ index: z.number().int().min(0).max(199) });
export const directoryImportRouter = router({
  access: protectedProcedure.query(({ ctx }) => directoryAccess(ctx.user)),
  preview: protectedProcedure
    .input(
      z.object({
        filename: z.string().trim().min(1).max(160),
        manifest: directoryManifest,
      })
    )
    .mutation(({ ctx, input }) =>
      previewDirectory(ctx.user, input.filename, input.manifest)
    ),
  list: protectedProcedure.query(({ ctx }) => listDirectoryBatches(ctx.user)),
  get: protectedProcedure
    .input(batch)
    .query(({ ctx, input }) => readDirectoryBatch(ctx.user, input.id)),
  applyRow: iamManageProcedure
    .input(row.extend({ password: z.string().max(256).optional() }))
    .mutation(({ ctx, input }) =>
      changeDirectoryRow(
        ctx.user,
        input.id,
        input.index,
        "apply",
        input.password
      )
    ),
  revert: iamManageProcedure
    .input(row)
    .mutation(({ ctx, input }) =>
      changeDirectoryRow(ctx.user, input.id, input.index, "revert")
    ),
});
