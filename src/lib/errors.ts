/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "not_found" | "invalid" | "conflict" | "unauthenticated" | "rate_limited" = "invalid",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "You do not have access to this resource.") => new AppError(msg, "forbidden");
export const notFound = (msg = "Not found.") => new AppError(msg, "not_found");
export const invalid = (msg: string) => new AppError(msg, "invalid");
export const conflict = (msg: string) => new AppError(msg, "conflict");
