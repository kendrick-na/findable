import Image from "next/image";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const headingId = (value: unknown) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

export function MarkdownArticle({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children, href }) => (
          <a
            className="font-medium text-[var(--findable-primary)] underline decoration-current/30 underline-offset-4 hover:decoration-current"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-8 border-[var(--findable-primary)] border-l-2 bg-black/[0.025] px-5 py-3 text-black/65">
            {children}
          </blockquote>
        ),
        h2: ({ children }) => (
          <h2
            className="mt-14 mb-4 scroll-mt-24 font-semibold font-serif text-2xl text-[#1f211f] tracking-tight md:text-3xl"
            id={headingId(children)}
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-9 mb-3 font-semibold text-[#1f211f] text-lg">
            {children}
          </h3>
        ),
        li: ({ children }) => <li className="my-1.5 pl-1">{children}</li>,
        code: ({ children }) => (
          <code className="rounded bg-black/[0.055] px-1.5 py-0.5 font-mono text-[.9em]">
            {children}
          </code>
        ),
        hr: () => <hr className="my-12 border-black/10" />,
        img: ({ alt, src }) => (
          <Image
            alt={alt ?? ""}
            className="my-10 aspect-video w-full rounded-sm bg-black/5 object-cover"
            height={675}
            src={typeof src === "string" ? src : ""}
            unoptimized
            width={1200}
          />
        ),
        ol: ({ children }) => (
          <ol className="my-5 list-decimal space-y-1 pl-6">{children}</ol>
        ),
        p: ({ children }) => (
          <p className="my-5 text-[#3f433f] text-[17px] leading-8">
            {children}
          </p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-[#1f211f]">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="my-5 list-disc space-y-1 pl-6">{children}</ul>
        ),
        table: ({ children }) => (
          <div className="my-8 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-black/15 border-b bg-black/[0.035] px-4 py-3 font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-black/10 border-b px-4 py-3 align-top leading-6">
            {children}
          </td>
        ),
      }}
      rehypePlugins={[rehypeSanitize]}
      remarkPlugins={[remarkGfm]}
    >
      {markdown}
    </ReactMarkdown>
  );
}
