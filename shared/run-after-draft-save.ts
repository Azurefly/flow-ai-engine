export class DraftSaveBeforeRunError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super("草稿保存失败，运行未启动。");
    this.name = "DraftSaveBeforeRunError";
    this.originalError = originalError;
  }
}

export async function runAfterDraftSave<T>(input: {
  workflowStatus: string;
  saveDraft?: () => Promise<void>;
  run: () => Promise<T>;
}): Promise<T> {
  if (input.workflowStatus !== "published" && input.saveDraft) {
    try {
      await input.saveDraft();
    } catch (error) {
      throw new DraftSaveBeforeRunError(error);
    }
  }
  return input.run();
}
