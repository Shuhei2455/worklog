import { apiRoute } from "@/lib/api/handler";
import { serializeResolutions } from "@/lib/api/serialize";

/** GET /api/v2/resolutions — スペース共通の定数 */
export const GET = apiRoute(async () => serializeResolutions());
