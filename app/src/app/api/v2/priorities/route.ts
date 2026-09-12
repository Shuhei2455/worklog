import { apiRoute } from "@/lib/api/handler";
import { serializePriorities } from "@/lib/api/serialize";

/** GET /api/v2/priorities — スペース共通の定数 */
export const GET = apiRoute<Record<string, never>>(async () => serializePriorities());
