import { readFlash } from "@/lib/flash";
import { currentUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PageTitle, ActionResult, Button, Card } from "@/components/ui";
import { LOCALES, translator } from "@/lib/i18n";
import { setLanguage } from "./actions";

const LABEL: Record<string, string> = { ja: "日本語", en: "English" };

/** 表示言語の設定 */
export default async function LanguageSettings({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const flash = await readFlash("/settings/language");
  const user = await currentUser();
  const t = translator(user.locale);

  return (
    <Shell user={user} breadcrumbs={[{ label: t("common.language") }]}>
      <PageTitle>{t("common.language")}</PageTitle>
      <ActionResult ok={flash.ok ?? (sp.ok ? t("common.save") : undefined)} error={sp.error ?? flash.error} />

      <Card className="max-w-sm p-4">
        <form action={setLanguage} className="flex items-end gap-2">
          <label className="text-base">
            <span className="block text-sm text-slate-500">{t("common.language")}</span>
            <select
              name="lang"
              defaultValue={user.locale}
              className="mt-1 rounded border border-control px-2 py-1"
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LABEL[l] ?? l}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" type="submit">
            {t("common.save")}
          </Button>
        </form>
      </Card>

      <p className="mt-3 max-w-sm text-sm text-slate-500">
        {user.locale === "en"
          ? "Status, priority and resolution names follow the official English terms."
          : "状態・優先度・完了理由の名前は、本家の英語表記に合わせています。"}
      </p>
    </Shell>
  );
}
