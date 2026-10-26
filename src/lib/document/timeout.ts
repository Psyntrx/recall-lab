import { AppError } from "@/lib/http/errors";
export async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> { let timer: ReturnType<typeof setTimeout>; try { return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new AppError(message, 504, "PROCESSING_TIMEOUT")), ms); })]); } finally { clearTimeout(timer!); } }
