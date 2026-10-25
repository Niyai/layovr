/** An error whose message is safe to show the user. */
export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 502,
    message: string,
  ) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
export const forbidden = (msg = "Not allowed for your role") =>
  new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
