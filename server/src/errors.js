export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);

// Parse request input with a zod schema, turning failures into a 400 with field details.
export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      'Request validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
