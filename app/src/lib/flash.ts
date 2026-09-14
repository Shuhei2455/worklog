import { cookies } from "next/headers";

/**
 * 1回だけ出すメッセージ（フラッシュ）。
 *
 * **なぜ要るか。**
 * 以前は結果を `redirect("/issues/AA-1?ok=...")` でクエリに載せて渡していた。
 * これだとメッセージは出るが、**同じURLでもナビゲーションが起きる**ので
 * 先頭までスクロールが戻り、「リロードされた」ように見える。
 *
 * サーバーアクションが `revalidatePath` だけで終われば、
 * サーバーコンポーネントが再描画されて DOM が差分更新される
 * （スクロール位置も入力欄の状態も保たれる）。
 * そのときにメッセージを運ぶ入れ物がこれ。
 *
 * **なぜ cookie か。** 各フォームをクライアントコンポーネントにして
 * `useActionState` で受け取る手もあるが、課題画面だけでフォームが14個あり、
 * 全部を "use client" にすると受け取る利点に見合わない。
 * cookie ならサーバーコンポーネントのまま読める。
 *
 * **消し方。** 描画中に cookie は消せない（Server Component から
 * `cookies().set()` は呼べない）ので、次の2つで漏れを抑えている:
 *   1. `maxAge` を5秒にして自然に消えるようにする
 *   2. **書いたパスを一緒に持たせ、別の画面では出さない**
 * これが無いと、操作直後に別の画面へ移ったときにそこでメッセージが出る。
 */

const NAME = "kadai_flash";

type Payload = {
  /** メッセージ本文 */
  m: string;
  /** エラーかどうか */
  e: boolean;
  /** このメッセージを出してよいパス */
  p: string;
};

/**
 * サーバーアクションから呼ぶ。次の描画で1回だけ出る。
 *
 * `path` には**その操作をした画面のパス**を渡す。
 * `revalidatePath` に渡すものと同じ値でよい。
 */
export async function setFlash(path: string, message: string, isError = false) {
  const payload: Payload = { m: message, e: isError, p: path };
  const store = await cookies();
  store.set(NAME, JSON.stringify(payload), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // 描画中に消せないので、短く切って自然に消えるようにする。
    // 長くすると、同じ画面を手で再読み込みしたときにもう一度出る
    maxAge: 5,
  });
}

/**
 * 画面側で読む。`ActionResult` にそのまま渡せる形で返す。
 *
 * `path` が一致しないフラッシュは**無視する**（別の画面のメッセージを出さない）。
 */
export async function readFlash(path: string): Promise<{ ok?: string; error?: string }> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return {};
  try {
    const payload = JSON.parse(raw) as Partial<Payload>;
    if (typeof payload.m !== "string" || payload.p !== path) return {};
    return payload.e ? { error: payload.m } : { ok: payload.m };
  } catch {
    // 壊れた値が入っていても画面は出す
    return {};
  }
}
