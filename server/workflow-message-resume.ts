export function waitSubscriptionResumeAction(input: {
  runStatus: string;
  waitType: string;
  parallel: boolean;
  hasAcceptedMessage: boolean;
  resumeAcceptedMessage: boolean;
}): "resume" | "defer" | "duplicate" | "skip" | "reject" {
  if (input.hasAcceptedMessage && !input.resumeAcceptedMessage)
    return "duplicate";
  if (input.runStatus === "waiting") return "resume";
  if (["running", "queued"].includes(input.runStatus)) {
    if (input.waitType === "timer" || input.resumeAcceptedMessage)
      return "skip";
    if (input.parallel && input.waitType === "message") return "defer";
  }
  return "reject";
}
