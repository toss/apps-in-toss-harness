/** Error carrying a server-authored Korean message; shown to the agent verbatim. */
export class ToolMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolMessageError';
  }
}
