"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { moveCard } from "./actions";

/**
 * ボードのドラッグ＆ドロップ部分。
 *
 * カードに出す項目は本家と同じで固定（課題キー・件名・担当者・期限日）。
 * カスタマイズはできない(docs/00-spec-verified.md 6章)。
 */

export type Card = {
  id: number;
  keyId: number;
  summary: string;
  assigneeName: string | null;
  dueDate: string | null;
  statusId: number;
};

export type Column = {
  id: number;
  name: string;
  color: string;
};

function CardView({ card, projectKey }: { card: Card; projectKey: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded border border-slate-200 bg-white p-2 text-sm shadow-sm ${
        isDragging ? "opacity-30" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-2">
        <Link
          href={`/issues/${projectKey}-${card.keyId}`}
          className="font-mono text-xs text-brand-700 hover:underline"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {projectKey}-{card.keyId}
        </Link>
      </div>
      <p className="mt-1 leading-snug">{card.summary}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        <span>{card.assigneeName ?? "未割り当て"}</span>
        {card.dueDate && <span className="ml-auto">{card.dueDate}</span>}
      </div>
    </li>
  );
}

function ColumnView({
  column,
  cards,
  projectKey,
  canCreate,
}: {
  column: Column;
  cards: Card[];
  projectKey: string;
  canCreate: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${column.id}` });

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="flex items-center gap-2 px-1 py-2 text-sm">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: column.color }}
        />
        <span className="font-medium">{column.name}</span>
        {/* 100件以上は +99 と出す（本家と同じ） */}
        <span className="rounded bg-slate-200 px-1.5 text-xs text-slate-600">
          {cards.length >= 100 ? "+99" : cards.length}
        </span>
      </div>
      <ul
        ref={setNodeRef}
        className={`flex min-h-32 flex-1 flex-col gap-2 rounded p-2 ${
          isOver ? "bg-brand-50" : "bg-slate-100"
        }`}
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((c) => (
            <CardView key={c.id} card={c} projectKey={projectKey} />
          ))}
        </SortableContext>
        {canCreate && (
          <Link
            href={`/projects/${projectKey}/issues/new`}
            className="rounded border border-dashed border-slate-300 py-1.5 text-center text-xs text-slate-500 hover:bg-white"
          >
            課題の追加
          </Link>
        )}
      </ul>
    </div>
  );
}

export function BoardClient({
  projectKey,
  columns,
  initialCards,
  canEdit,
  canCreate,
}: {
  projectKey: string;
  columns: Column[];
  initialCards: Card[];
  canEdit: boolean;
  canCreate: boolean;
}) {
  const [cards, setCards] = useState(initialCards);
  const [dragging, setDragging] = useState<Card | null>(null);
  const [, startTransition] = useTransition();
  const [live, setLive] = useState(false);
  const router = useRouter();
  // 自分の操作で返ってくるイベントでは再取得しない。
  // ドラッグ直後に再取得すると、まだ反映前の状態で画面が巻き戻る
  const selfMoves = useRef(new Set<number>());

  // サーバー側の更新を受け取って画面を作り直す。
  // WebSocket ではなく SSE なのは、職場のプロキシで詰まる可能性があるため
  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectKey}/events`);
    es.addEventListener("ready", () => setLive(true));
    es.addEventListener("issue.moved", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { issueId: number };
        if (selfMoves.current.delete(data.issueId)) return;
      } catch {
        // 壊れたイベントでも再取得しておけば表示は合う
      }
      router.refresh();
    });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [projectKey, router]);

  // サーバーから新しい一覧が来たら、楽観的に動かした状態を捨てて合わせる
  useEffect(() => {
    setCards(initialCards);
  }, [initialCards]);

  // 少し動かしてからドラッグを開始する。
  // そうしないと課題キーのリンクが押せない
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const byColumn = (statusId: number) => cards.filter((c) => c.statusId === statusId);

  function onDragStart(e: DragStartEvent) {
    setDragging(cards.find((c) => c.id === e.active.id) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;

    const card = cards.find((c) => c.id === active.id);
    if (!card) return;

    // 列そのものに落とした場合と、カードの上に落とした場合の両方を扱う
    const overId = String(over.id);
    let toStatusId: number;
    let toIndex: number;

    if (overId.startsWith("col-")) {
      toStatusId = Number(overId.slice(4));
      toIndex = byColumn(toStatusId).filter((c) => c.id !== card.id).length;
    } else {
      const overCard = cards.find((c) => c.id === over.id);
      if (!overCard) return;
      toStatusId = overCard.statusId;
      const list = byColumn(toStatusId).filter((c) => c.id !== card.id);
      toIndex = list.findIndex((c) => c.id === overCard.id);
      if (toIndex < 0) toIndex = list.length;
    }

    if (!canEdit && toStatusId !== card.statusId) return;
    if (toStatusId === card.statusId) {
      const list = byColumn(toStatusId);
      const from = list.findIndex((c) => c.id === card.id);
      if (from === toIndex) return;
    }

    // 先に画面を動かす。サーバーの応答を待つとドラッグの手応えが鈍い
    setCards((prev) => {
      const rest = prev.filter((c) => c.id !== card.id);
      const target = rest.filter((c) => c.statusId === toStatusId);
      const others = rest.filter((c) => c.statusId !== toStatusId);
      target.splice(toIndex, 0, { ...card, statusId: toStatusId });
      return [...others, ...target];
    });

    selfMoves.current.add(card.id);
    startTransition(async () => {
      await moveCard(projectKey, card.id, toStatusId, toIndex);
    });
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            live ? "bg-emerald-500" : "bg-slate-300"
          }`}
        />
        {live ? "他の人の変更がリアルタイムに反映されます" : "接続していません"}
      </p>
      <div className="mt-2 flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => (
          <ColumnView
            key={col.id}
            column={col}
            cards={byColumn(col.id)}
            projectKey={projectKey}
            canCreate={canCreate && col.id === columns[0]?.id}
          />
        ))}
      </div>
      <DragOverlay>
        {dragging && (
          <div className="w-64 rounded border border-brand-600 bg-white p-2 text-sm shadow-lg">
            <span className="font-mono text-xs text-brand-700">
              {projectKey}-{dragging.keyId}
            </span>
            <p className="mt-1 leading-snug">{dragging.summary}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
