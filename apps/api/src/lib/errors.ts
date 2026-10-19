export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function ensure(value: unknown, status: number, message: string): asserts value { if (!value) throw new HttpError(status, message); }
export function id(value: unknown): number {
  const result = Number(value);
  ensure(Number.isSafeInteger(result) && result > 0, 400, 'معرّف غير صالح');
  return result;
}
