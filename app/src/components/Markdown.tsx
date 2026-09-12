import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/**
 * Markdown の描画。
 *
 * 本家も2025年10月から GitHub Flavored Markdown 準拠
 * (docs/00-spec-verified.md 8章)。Backlog記法は実装しない。
 *
 * **必ず rehype-sanitize を通す。** 課題の詳細やコメントは誰でも書けるので、
 * 素通しすると保存型XSSになる。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-kadai">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          // 外部リンクは新しいタブで開き、リファラを渡さない
          a: ({ href, children }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-brand-700 underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
