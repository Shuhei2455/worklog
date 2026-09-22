"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { renderMentions } from "@/lib/mention";

/**
 * Markdown を書く欄。編集とプレビューを切り替えられる。
 *
 * 素の textarea だと、書いた記法がどう出るか送信するまで分からない。
 * Backlog記法から移ってくる人は特に、`** **` が効かないことに気づけない。
 *
 * **ライブラリは足していない。** 表示は既存の Markdown コンポーネントを
 * そのまま使う（react-markdown はクライアントでも動く）。
 *
 * メンションは `<@U5>` のまま保存し、表示のときだけ名前に解決する。
 * プレビューでも同じ変換を通さないと、本文と見え方が食い違う。
 *
 * この部品だけがクライアント側で、**フォーム自体はサーバーアクションのまま**。
 * 課題画面のフォーム14個を "use client" にしない方針は変えていない（CLAUDE.md）。
 */
export function MarkdownEditor({
  name,
  defaultValue = "",
  rows = 3,
  placeholder,
  users = [],
  teams = [],
  children,
}: {
  name: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  /** メンションを名前に直すための対応表 */
  users?: Array<{ id: number; name: string }>;
  teams?: Array<{ id: number; name: string }>;
  /** 書き方の案内など、欄の下に出すもの */
  children?: React.ReactNode;
}) {
  const [text, setText] = useState(defaultValue);
  const [preview, setPreview] = useState(false);

  const tab = (on: boolean) =>
    `rounded-pill px-3 py-0.5 text-xs ${
      on ? "bg-brand-600 text-white" : "text-brand-700 hover:bg-brand-50"
    }`;

  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <button type="button" className={tab(!preview)} onClick={() => setPreview(false)}>
          編集
        </button>
        <button type="button" className={tab(preview)} onClick={() => setPreview(true)}>
          プレビュー
        </button>
      </div>

      {/* textarea は隠すだけにする。作り直すと入力中の値が消える */}
      <textarea
        name={name}
        rows={rows}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        hidden={preview}
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
      />

      {preview && (
        <div
          className="min-h-[5rem] rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
          style={{ minHeight: `${rows * 1.6 + 1}rem` }}
        >
          {text.trim() ? (
            <Markdown>
              {renderMentions(text, {
                users: new Map(users.map((u) => [u.id, u.name])),
                teams: new Map(teams.map((t) => [t.id, t.name])),
              })}
            </Markdown>
          ) : (
            <span className="text-slate-400">まだ何も書かれていません</span>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
