/** An unverified brand mention is not evidence of absence in a time series. */
export function isTrackableResponse(
  response: {
    engineId: string;
    errorMessage: string | null;
    isStub: boolean;
    mentionQuality?: string;
    promptText: string;
  },
  validEngineIds: ReadonlySet<string>
): boolean {
  return (
    !response.isStub &&
    !response.errorMessage &&
    response.mentionQuality !== "unverified" &&
    validEngineIds.has(response.engineId) &&
    response.promptText.trim().length > 0
  );
}
