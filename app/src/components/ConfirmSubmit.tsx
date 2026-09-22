"use client";

import { Button } from "@/components/ui";
import type { ComponentProps } from "react";

/**
 * 押したら取り返しがつかない操作の確認。
 *
 * 2026-09-23 にタスクを1件消してしまったため追加した。削除のボタンが
 * 押した瞬間に送信されていて、**確認を挟む手が無かった**。
 * タスクは物理削除なので、監査ログに件名が残るだけで本体は戻らない。
 *
 * `confirm()` で足りる。ダイアログの部品を入れるほどの用事ではないし、
 * ブラウザ標準なら誤操作しにくい位置にボタンが出る。
 *
 * **この部品だけがクライアント側で、フォームはサーバーアクションのまま。**
 */
export function ConfirmSubmit({
  message,
  children,
  ...rest
}: {
  /** 何が起きるかを具体的に書く。「よろしいですか」だけでは判断できない */
  message: string;
} & ComponentProps<typeof Button>) {
  return (
    <Button
      {...rest}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
